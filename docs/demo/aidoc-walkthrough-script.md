# AiDoc walkthrough production script

This is the reviewed 80-second narrative for a future full walkthrough. The
timing matches `docs/demo/aidoc-walkthrough.vtt`.

The checked-in README animation is deterministic and does not claim to invoke
Codex. It is a five-frame rendering of the accepted `createUser` story, not a
recorded model run, provider call, or repository write. The future full
recording is a live Codex host workflow recorded in a fresh disposable
repository. The live recording must follow this script and the checklist.

## 0-10s: show the code change

On screen, show the small source diff:

```text
createUser(email) -> createUser(email, role)
```

Say or caption: "The code changed. README.md and docs/API.md may now be
stale, so the documentation needs a focused review."

Do not show a personal terminal, account details, or a private repository.

## 10-25s: install the beta and run `aidoc plan`

Show the public installation and planning path:

```text
npm install -g @mr-min-max/aidoc-gen@beta
aidoc plan
```

Say or caption: "Install the public beta, then run `aidoc plan`. AiDoc compares
the code change through its AST-backed analysis and identifies the affected
documentation targets."

Keep the output focused on `README.md` and `docs/API.md`. Do not add invented
counts, scores, or timing claims.

## 25-50s: host the bounded prepare and validate workflow

Show the live Codex host receiving AiDoc's bounded preparation. The host calls
`prepare_documentation_update`, drafts the relevant Markdown, and then calls
`validate_documentation_draft` with that candidate. Keep the tools and their
order visible without exposing a raw preparation digest or private prompt.

Say or caption: "Codex uses AiDoc's bounded prepare and validate tools. The
host owns the draft. AiDoc checks the candidate and keeps the repository
unchanged while the host workflow is in progress."

The provider-free host path must not be presented as an AiDoc provider call or
as an automatic write.

## 50-70s: review the focused diff before writing

Show only the focused changes in `README.md` and `docs/API.md`:

```diff
- createUser(email)
+ createUser(email, role)
```

Say or caption: "Review the diff. Both documents align the same role
signature, and the maintainer decides whether anything should be written."

Do not present the diff as a Codex response or claim that validation replaces
maintainer review.

## 70-80s: invite public-beta use

End on the validated state and the words `Public beta`.

Say or caption: "AiDoc is an open source public beta for maintainers. Try the
workflow on a real code change, inspect the diff, and keep the final write
under your control."

The MP4 is an optional future recording. The checked-in animation remains the
small deterministic README asset, while the live full recording is reviewed
separately before upload.
