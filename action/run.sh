#!/usr/bin/env bash
set -euo pipefail

provider="${AIDOC_INPUT_PROVIDER:-openai}"
model="${AIDOC_INPUT_MODEL:-}"
commands="${AIDOC_INPUT_COMMANDS:-readme}"
mode="${AIDOC_INPUT_MODE:-generate}"
output_dir="${AIDOC_INPUT_OUTPUT_DIR:-./docs}"
dry_run="${AIDOC_INPUT_DRY_RUN:-false}"
since="${AIDOC_INPUT_SINCE:-HEAD~1}"
api_key="${AIDOC_INPUT_API_KEY:-}"
changed_files_file="${AIDOC_CHANGED_FILES_FILE:-}"

case "$mode" in
  generate|check) ;;
  *) echo "Unsupported aidoc Action mode: $mode" >&2; exit 2 ;;
esac

case "$dry_run" in
  true|false) ;;
  *) echo "Unsupported aidoc dry-run value: $dry_run" >&2; exit 2 ;;
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
    echo "Unsupported aidoc provider: $provider" >&2
    exit 2
    ;;
esac

if [ "$mode" = "generate" ] && [ "$provider" != "ollama" ] && [ -z "$api_key" ]; then
  echo "The $provider provider requires the api-key Action input" >&2
  exit 2
fi

export AIDOC_PROVIDER="$provider"
export AIDOC_MODEL="$model"

changed="false"
changed_files=()
summary_lines=()
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
    *) echo "Unsupported aidoc command: $command_name" >&2; exit 2 ;;
  esac

  if [ "$mode" = "check" ]; then
    aidoc check --target "$output_file" --since "$since"
    summary_lines+=("Co-change check passed for $output_file")
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
