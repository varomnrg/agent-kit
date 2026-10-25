# Compass principles

Each principle is a heuristic, not authority. Apply it only when its trigger
changes a real decision.

## Smallest sufficient change

**Trigger:** sizing a change, adding a layer, or touching obsolete structure.

Solve the complete problem with the least justified change. Remove dead weight
before adding machinery.

**Misuse guard:** small does not mean partial, proxy-only, or unverified.

## Foundational model

**Trigger:** stateful logic, repeated shape assumptions, or unclear ownership.

Name the data shape, ownership, state transitions, and core types before writing
surrounding logic. Choose a structure that makes valid operations obvious.

**Misuse guard:** do not build an elaborate model for a local value with no
repeated rule.

## Coherent redesign

**Trigger:** a requirement changes a foundational assumption.

Ask what the design would be if the requirement had existed from the beginning,
then integrate it coherently rather than attaching another exception.

**Misuse guard:** do not turn every feature into a rewrite; use this only when
the old foundation is the source of complexity.

## Reader locality

**Trigger:** answering one question requires tracing layers or hidden state.

Concentrate related behavior and knowledge behind a useful interface. Reduce
one-caller wrappers, scattered mutation, and facts callers must remember.

**Misuse guard:** fewer files is not automatically clearer; preserve real seams.

## Target-state migration

**Trigger:** controlled consumers are split between old and new internal paths.

Move the bounded consumers and delete obsolete compatibility in the same
migration so temporary paths do not become permanent architecture.

**Misuse guard:** public or independently versioned consumers may require an
explicit compatibility window.

## Boundary discipline

**Trigger:** data crosses configuration, CLI, network, storage, framework, or
other external seams.

Parse, validate, and normalize at the seam. Let internal logic rely on the
resulting invariants and remain direct.

**Misuse guard:** validate again when trust changes; do not call an arbitrary
function boundary external.

## Idempotent operations

**Trigger:** retry, resume, reconcile, crash recovery, or partial execution.

Design repeated execution to converge on the same intended state.

**Misuse guard:** idempotence does not make a destructive operation safe or
authorized.

## Separate shared state

**Trigger:** multiple actors could write the same file, branch, key, object, or
working directory.

Remove overlapping ownership before adding locks or serialization. Serialize
only when one shared writer is a real invariant.

**Misuse guard:** splitting work must not duplicate authority or lose an atomic
business invariant.

## Attack the premise

**Trigger:** two or more failed attempts depend on the same assumption.

State that assumption and test it directly before attempting another variant.

**Misuse guard:** do not wait for repeated failure when evidence already
contradicts the premise.

## Root-cause proof

**Trigger:** a defect, regression, failure, or completion claim.

Reproduce the exact symptom, find the earliest incorrect state, fix the cause,
and exercise the real affected behavior afterward.

**Misuse guard:** a guard is a root fix only when the guarded state is legitimate;
proof must discriminate the reported failure.

## Behavioral contract

**Trigger:** writing, changing, or deciding whether to preserve a test.

Assert behavior observable through the relevant interface. The test should fail
when the promise breaks and survive internal restructuring.

**Misuse guard:** internals may be the behavior for a low-level contract; do not
force every test through an expensive outer surface.

## Verifiable units

**Trigger:** a sweep, migration, or multi-step delivery.

Order bounded units so each ends in an observable check and establishes the
basis for the next.

**Misuse guard:** do not split an atomic invariant into independently broken
states merely to make more steps.

## Explain the measurement

**Trigger:** a benchmark, evaluation score, latency, throughput, or other number
will drive a claim or decision.

Establish what ran, what limits the result, whether the output remained correct,
and whether repeated comparable runs reproduce it.

**Misuse guard:** a precise number is not useful when the measurement surface is
not the user-relevant one.

## Earn the mechanism

**Trigger:** a manual step or instruction repeats, or a high-risk check needs
deterministic enforcement.

Encode it in a script, check, type, or reusable structure when that mechanism is
cheaper and more reliable than recurring judgment.

**Misuse guard:** do not build infrastructure for a one-off easy action or an
unobserved hypothetical problem.

## Explore consequential alternatives

**Trigger:** a novel, costly-to-reverse choice has no useful precedent.

Compare concrete alternatives—often small prototypes—against the outcome and
proof before committing.

**Misuse guard:** do not prototype routine or readily reversible decisions.
