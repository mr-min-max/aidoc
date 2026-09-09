#!/usr/bin/env bash
set -euo pipefail

provider="${AIDOC_INPUT_PROVIDER:-openai}"
model="${AIDOC_INPUT_MODEL:-}"
commands="${AIDOC_INPUT_COMMANDS:-readme}"
mode="${AIDOC_INPUT_MODE:-review}"
output_dir="${AIDOC_INPUT_OUTPUT_DIR:-./docs}"
dry_run="${AIDOC_INPUT_DRY_RUN:-false}"
since="${AIDOC_INPUT_SINCE:-HEAD~1}"
api_key="${AIDOC_INPUT_API_KEY:-}"
changed_files_file="${AIDOC_CHANGED_FILES_FILE:-}"
trust_policy="${AIDOC_INPUT_TRUST_POLICY:-strict}"
fail_on="${AIDOC_INPUT_FAIL_ON:-none}"
comment="${AIDOC_INPUT_COMMENT:-true}"
labels="${AIDOC_INPUT_LABELS:-true}"
github_token="${AIDOC_INPUT_GITHUB_TOKEN:-}"

case "$mode" in
  review|generate|check) ;;
  *) echo "Unsupported aidoc Action mode input" >&2; exit 2 ;;
esac

if [ "$mode" = "review" ]; then
  case "$fail_on" in
    none|stale|breaking) ;;
    *) echo "Unsupported aidoc fail-on input" >&2; exit 2 ;;
  esac
  case "$comment" in
    true|false) ;;
    *) echo "Unsupported aidoc comment input" >&2; exit 2 ;;
  esac
  case "$labels" in
    true|false) ;;
    *) echo "Unsupported aidoc labels input" >&2; exit 2 ;;
  esac

  export AIDOC_ORIGIN="action"
  runner_temp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
  mkdir -p "$runner_temp"
  report="$runner_temp/aidoc-review.json"
  markdown="$runner_temp/aidoc-review.md"
  text_report="$runner_temp/aidoc-review.txt"
  base="${AIDOC_PR_BASE_SHA:-}"
  head="${AIDOC_PR_HEAD_SHA:-}"
  in_pr="true"
  if [ -z "$base" ]; then
    in_pr="false"
    base="$since"
  fi
  if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    echo "AiDoc could not find the pull request base commit $base; use actions/checkout with fetch-depth: 0." >&2
    exit 2
  fi

  review_args=(review --format json --fail-on "$fail_on" --base "$base")
  if [ -n "$head" ]; then review_args+=(--head "$head"); fi
  review_status=0
  aidoc "${review_args[@]}" > "$report" || review_status=$?

  presentation_failure=0
  if [ "$in_pr" = "false" ]; then
    text_status=0
    text_args=(review --format text --fail-on "$fail_on" --base "$base")
    aidoc "${text_args[@]}" > "$text_report" || text_status=$?
    if [ "$text_status" -ne 0 ] && [ "$text_status" -ne 1 ]; then
      presentation_failure="$text_status"
    fi
  else
    markdown_status=0
    markdown_args=(review --format markdown --fail-on "$fail_on" --base "$base")
    if [ -n "$head" ]; then markdown_args+=(--head "$head"); fi
    aidoc "${markdown_args[@]}" > "$markdown" || markdown_status=$?
    if [ "$markdown_status" -ne 0 ] && [ "$markdown_status" -ne 1 ]; then
      presentation_failure="$markdown_status"
    fi
  fi

  verdict=""
  public_api_changes=""
  stale_documents=""
  breaking=""
  if [ -s "$report" ]; then
    verdict="$(jq -r '.verdict // empty' "$report")"
    public_api_changes="$(jq -r '.summary.publicApiChanges // 0' "$report")"
    stale_documents="$(jq -r '.summary.staleDocuments // 0' "$report")"
    breaking="$(jq -r '.summary.breaking // 0' "$report")"
  fi

  {
    echo "verdict=$verdict"
    echo "public-api-changes=$public_api_changes"
    echo "stale-documents=$stale_documents"
    echo "breaking=$breaking"
    echo "report=$report"
    echo "changed=false"
    echo "files<<AIDOC_FILES_EOF"
    echo "AIDOC_FILES_EOF"
    echo "summary<<AIDOC_SUMMARY_EOF"
    if [ "$in_pr" = "true" ] && [ -s "$markdown" ]; then
      cat "$markdown"
    elif [ -s "$text_report" ]; then
      cat "$text_report"
    fi
    echo "AIDOC_SUMMARY_EOF"
  } >> "$GITHUB_OUTPUT"

  permission_notice_sent="false"
  operation_failure=0
  mark_operation_failure() {
    if [ "$operation_failure" -eq 0 ]; then operation_failure="$1"; fi
  }
  posting_notice() {
    if [ "$permission_notice_sent" = "false" ]; then
      echo "::notice::AiDoc could not post a comment (read-only token); see the job summary"
      if [ -n "${GITHUB_STEP_SUMMARY:-}" ] && [ -f "$markdown" ]; then
        cat "$markdown" >> "$GITHUB_STEP_SUMMARY"
      fi
      permission_notice_sent="true"
    fi
  }

  if [ "$in_pr" = "false" ]; then
    if [ -s "$text_report" ]; then cat "$text_report"; fi
    if [ "$presentation_failure" -ne 0 ]; then exit "$presentation_failure"; fi
    exit "$review_status"
  fi

  repo="${AIDOC_REPOSITORY:-${GITHUB_REPOSITORY:-}}"
  pr_number="${AIDOC_PR_NUMBER:-}"
  if [ -n "$repo" ] && [ -n "$pr_number" ]; then
    comments="$runner_temp/aidoc-review-comments.json"
    comments_stderr="$runner_temp/aidoc-review-comments.err"
    comments_status=0
    comment_id=""
    if [ "$comment" = "true" ]; then
      GH_TOKEN="$github_token" gh api "repos/$repo/issues/$pr_number/comments" --paginate > "$comments" 2> "$comments_stderr" || comments_status=$?
      if [ "$comments_status" -eq 0 ] && [ -s "$comments" ]; then
        # The default GITHUB_TOKEN is a GitHub App installation access token and
        # GET /user is not available to it, so an identity lookup failure must fall
        # back to the documented bot login instead of skipping the comment.
        token_user="github-actions[bot]"
        token_user_from_api="$(GH_TOKEN="$github_token" gh api user --jq '.login' 2>/dev/null)" || token_user_from_api=""
        if [ -n "$token_user_from_api" ]; then
          token_user="$token_user_from_api"
        fi
        comment_id="$(jq -s -r --arg marker '<!-- aidoc-review -->' --arg user "$token_user" 'add | map(select(((.body // "") | startswith($marker)) and ((.user.login // "") == $user))) | .[0].id // empty' "$comments")"
      elif [ "$comments_status" -ne 0 ]; then
        comments_error="$(cat "$comments_stderr")"
        case "$comments_error" in
          *403*|*Forbidden*) posting_notice ;;
          *) mark_operation_failure "$comments_status" ;;
        esac
      fi

      if [ "$comments_status" -eq 0 ]; then
        if [ "$public_api_changes" = "0" ] || [ -z "$public_api_changes" ]; then
          if [ -n "$comment_id" ]; then
            delete_status=0
            delete_output="$(GH_TOKEN="$github_token" gh api -X DELETE "repos/$repo/issues/comments/$comment_id" 2>&1)" || delete_status=$?
            if [ "$delete_status" -ne 0 ]; then
              case "$delete_output" in
                *403*|*Forbidden*) posting_notice ;;
                *404*|*Not\ Found*) ;;
                *) mark_operation_failure "$delete_status" ;;
              esac
            fi
          fi
        else
          comment_payload="$runner_temp/aidoc-review-comment.json"
          jq -n --rawfile body "$markdown" '{body: $body}' > "$comment_payload"
          comment_status=0
          if [ -n "$comment_id" ]; then
            comment_output="$(GH_TOKEN="$github_token" gh api -X PATCH "repos/$repo/issues/comments/$comment_id" --input "$comment_payload" 2>&1)" || comment_status=$?
          else
            comment_output="$(GH_TOKEN="$github_token" gh api -X POST "repos/$repo/issues/$pr_number/comments" --input "$comment_payload" 2>&1)" || comment_status=$?
          fi
          if [ "$comment_status" -ne 0 ]; then
            case "$comment_output" in
              *403*|*Forbidden*) posting_notice ;;
              *) mark_operation_failure "$comment_status" ;;
            esac
          fi
        fi
      fi
    fi

    if [ "$labels" = "true" ]; then
      docs_label_description="Documentation sections mentioning changed public symbols are stale"
      breaking_label_description="Potentially breaking public API changes detected"
      label_create_status=0
      label_create_output="$(GH_TOKEN="$github_token" gh label create docs-stale --color e4e669 --description "$docs_label_description" --force 2>&1)" || label_create_status=$?
      if [ "$label_create_status" -ne 0 ]; then
        case "$label_create_output" in *403*|*Forbidden*) posting_notice ;; *) mark_operation_failure "$label_create_status" ;; esac
      fi
      label_create_status=0
      label_create_output="$(GH_TOKEN="$github_token" gh label create breaking-change --color d73a4a --description "$breaking_label_description" --force 2>&1)" || label_create_status=$?
      if [ "$label_create_status" -ne 0 ]; then
        case "$label_create_output" in *403*|*Forbidden*) posting_notice ;; *) mark_operation_failure "$label_create_status" ;; esac
      fi
      label_payload="$runner_temp/aidoc-review-label.json"
      if [ "${stale_documents:-0}" -gt 0 ] 2>/dev/null; then
        jq -n '{labels:["docs-stale"]}' > "$label_payload"
        label_status=0
        label_output="$(GH_TOKEN="$github_token" gh api -X POST "repos/$repo/issues/$pr_number/labels" --input "$label_payload" 2>&1)" || label_status=$?
        if [ "$label_status" -ne 0 ]; then
          case "$label_output" in *403*|*Forbidden*) posting_notice ;; *) mark_operation_failure "$label_status" ;; esac
        fi
      else
        delete_label_status=0
        delete_label_output="$(GH_TOKEN="$github_token" gh api -X DELETE "repos/$repo/issues/$pr_number/labels/docs-stale" 2>&1)" || delete_label_status=$?
        if [ "$delete_label_status" -ne 0 ]; then
          case "$delete_label_output" in
            *403*|*Forbidden*) posting_notice ;;
            *404*|*Not\ Found*) ;;
            *) mark_operation_failure "$delete_label_status" ;;
          esac
        fi
      fi
      if [ "${breaking:-0}" -gt 0 ] 2>/dev/null; then
        jq -n '{labels:["breaking-change"]}' > "$label_payload"
        label_status=0
        label_output="$(GH_TOKEN="$github_token" gh api -X POST "repos/$repo/issues/$pr_number/labels" --input "$label_payload" 2>&1)" || label_status=$?
        if [ "$label_status" -ne 0 ]; then
          case "$label_output" in *403*|*Forbidden*) posting_notice ;; *) mark_operation_failure "$label_status" ;; esac
        fi
      else
        delete_label_status=0
        delete_label_output="$(GH_TOKEN="$github_token" gh api -X DELETE "repos/$repo/issues/$pr_number/labels/breaking-change" 2>&1)" || delete_label_status=$?
        if [ "$delete_label_status" -ne 0 ]; then
          case "$delete_label_output" in
            *403*|*Forbidden*) posting_notice ;;
            *404*|*Not\ Found*) ;;
            *) mark_operation_failure "$delete_label_status" ;;
          esac
        fi
      fi
    fi
  fi

  if [ "$operation_failure" -ne 0 ]; then exit "$operation_failure"; fi
  if [ "$presentation_failure" -ne 0 ]; then exit "$presentation_failure"; fi
  exit "$review_status"
fi

case "$trust_policy" in
  warn|redact|strict) ;;
  *) echo "Unsupported aidoc trust-policy input" >&2; exit 2 ;;
esac

case "$dry_run" in
  true|false) ;;
  *) echo "Unsupported aidoc dry-run input" >&2; exit 2 ;;
esac

case "$provider" in
  openai)
    export OPENAI_API_KEY="$api_key"
    ;;
  anthropic)
    export ANTHROPIC_API_KEY="$api_key"
    ;;
  ollama)
    ;;
  *)
    echo "Unsupported aidoc provider input" >&2
    exit 2
    ;;
esac

if [ "$mode" = "generate" ] && [ "$provider" != "ollama" ] && [ -z "$api_key" ]; then
  echo "The selected remote provider requires the api-key Action input" >&2
  exit 2
fi

export AIDOC_PROVIDER="$provider"
export AIDOC_MODEL="$model"
export AIDOC_TRUST_POLICY="$trust_policy"
export AIDOC_ORIGIN="action"

changed="false"
changed_files=()
summary_lines=()
check_exit_status=0
if [ -n "$changed_files_file" ]; then
  : > "$changed_files_file"
fi

IFS=',' read -ra command_list <<< "$commands"
for raw_command in "${command_list[@]}"; do
  command_name="$(printf '%s' "$raw_command" | xargs)"
  case "$command_name" in
    readme) output_file="./README.md" ;;
    api) output_file="$output_dir/API.md" ;;
    changelog) output_file="./CHANGELOG.md" ;;
    diagram) output_file="$output_dir/architecture.md" ;;
    *) echo "Unsupported aidoc command input" >&2; exit 2 ;;
  esac

  if [ "$mode" = "check" ]; then
    check_status=0
    check_report="$(aidoc check --target "$output_file" --since "$since" --json)" || check_status=$?
    check_message="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).message)' "$check_report")"
    summary_lines+=("$check_message")
    if [ "$check_status" -ne 0 ]; then
      check_exit_status="$check_status"
      break
    fi
    continue
  fi

  before=""
  if [ -f "$output_file" ]; then
    before="$(cksum "$output_file")"
  fi

  args=(
    "$command_name"
    "--output"
    "$output_file"
    "--yes"
    "--strict-output"
  )
  if [ "$dry_run" = "true" ]; then
    args+=("--dry-run")
  fi
  aidoc "${args[@]}"

  if [ "$dry_run" != "true" ]; then
    after=""
    if [ -f "$output_file" ]; then
      after="$(cksum "$output_file")"
    fi
    if [ "$before" != "$after" ]; then
      changed="true"
      changed_files+=("$output_file")
      if [ -n "$changed_files_file" ]; then
        printf '%s\n' "$output_file" >> "$changed_files_file"
      fi
    fi
  fi
  summary_lines+=("Generated $output_file")
done

{
  echo "changed=$changed"
  echo "files<<AIDOC_FILES_EOF"
  if [ "${#changed_files[@]}" -gt 0 ]; then
    printf '%s\n' "${changed_files[@]}"
  fi
  echo "AIDOC_FILES_EOF"
  echo "summary<<AIDOC_SUMMARY_EOF"
  printf '%s\n' "${summary_lines[@]}"
  echo "AIDOC_SUMMARY_EOF"
} >> "$GITHUB_OUTPUT"

if [ "$check_exit_status" -ne 0 ]; then
  exit "$check_exit_status"
fi
