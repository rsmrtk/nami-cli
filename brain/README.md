# brain — what makes nami an SRE/FinOps agent

Ported from `naki-cli` so nami (the nami fork) works the way naki does.

| Here | Came from naki-cli |
|---|---|
| `agent/build.md` | `naki/agent/prompt.py` — the system prompt, rewritten for nami's tool names |
| `agent/sre.md`, `agent/finops.md` | `naki/agent/subagents.py` — role playbooks, as switchable agents with a narrowed toolset |
| `tool/` | the 19 SRE/FinOps tools (`naki/agent/tools/*.py`) already ported to TypeScript |
| `evals/scenarios/` | `naki/evals/scenarios/` — 11 behavioural scenarios, unchanged |
| `evals/runner.ts`, `evals/run.ts` | `naki/evals/runner.py` — scoring and the bench against `nami run` |
| `test/` | the parts of `naki-cli/tests` that cover code which exists here, rewritten for `bun test` |
| `policy.example.yaml` | `.naki/policy.yaml` example |

## Use

    bun install        # yaml, and links @rsmrtk/plugin from packages/plugin
    bun test ./test    # fast, no model
    bun run eval       # slow: real model via `nami run`; `bun run eval 01 09` for a subset
    ./install.sh       # make nami load this folder (~/.config/rsmrtk/{tool,agent})

## Not ported (naki has it, nami does not)

Enforced in code in naki, so only *stated* to the model here: `.naki/policy.yaml`
guardrails, `change_plan` approval, the vault (`${vault:NAME}`), audit log,
untrusted-output scrubbing, the `evidence` guard (recorded, never enforced),
compaction, and AWS SigV4 / GCP / Azure metrics auth. Scenario 04 (policy is not
routed around) needs the policy engine; until it exists it can only pass by the
model's own judgement.
