import { GenerateOptions, LLMProvider } from "../providers/types";
import {
  RedactionSession,
  applySecretPolicy,
  sanitizeDiagnostic,
} from "./scanner";
import {
  FindingSummary,
  TrustPolicy,
  TrustTextResult,
  TrustViolationError,
} from "./types";

export type GenerationOperation =
  | "readme"
  | "api"
  | "jsdoc"
  | "changelog"
  | "diagram"
  | "update";

export type GenerationOrigin = "cli" | "action" | "mcp";

export interface ContextEnvelope {
  operation: GenerationOperation;
  systemPrompt: string;
  prompt: string;
}

export interface TrustEvent {
  stage: "input" | "output" | "error";
  operation: GenerationOperation;
  origin: GenerationOrigin;
  policy: TrustPolicy;
  action: "allowed" | "warned" | "redacted" | "blocked";
  findings: FindingSummary[];
}

export interface GatewayOptions {
  policy: TrustPolicy;
  origin: GenerationOrigin;
  onEvent?: (event: TrustEvent) => void;
}

interface ApprovedInput {
  systemPrompt: string;
  prompt: string;
}

export class TrustGateway {
  private readonly session = new RedactionSession();
  private readonly policy: TrustPolicy;
  private readonly origin: GenerationOrigin;
  private readonly eventHook?: (event: TrustEvent) => void;

  constructor(
    private readonly provider: LLMProvider,
    options: GatewayOptions,
  ) {
    this.policy = options.policy;
    this.origin = options.origin;
    this.eventHook = options.onEvent;
  }

  async generate(
    envelope: ContextEnvelope,
    options: Omit<GenerateOptions, "systemPrompt"> = {},
  ): Promise<string> {
    const input = this.approveInput(envelope);
    const output = await this.generateTransport(envelope, input, options);
    return this.approveOutput(envelope, output);
  }

  async generateStream(
    envelope: ContextEnvelope,
    options: Omit<GenerateOptions, "systemPrompt">,
    onApprovedOutput: (content: string) => void,
  ): Promise<string> {
    const input = this.approveInput(envelope);

    if (!this.provider.generateStream) {
      const output = await this.generateTransport(envelope, input, options);
      const approvedOutput = this.approveOutput(envelope, output);
      onApprovedOutput(approvedOutput);
      return approvedOutput;
    }

    let output: string;
    try {
      output = await this.provider.generateStream(
        input.prompt,
        { ...options, systemPrompt: input.systemPrompt },
        () => undefined,
      );
    } catch (error: unknown) {
      this.throwSanitizedProviderError(envelope, error);
    }

    const approvedOutput = this.approveOutput(envelope, output);
    onApprovedOutput(approvedOutput);
    return approvedOutput;
  }

  private approveInput(envelope: ContextEnvelope): ApprovedInput {
    if (this.policy === "strict") {
      return this.approveStrictInput(envelope);
    }

    const system = applySecretPolicy(
      envelope.systemPrompt,
      this.policy,
      this.session,
    );
    const prompt = applySecretPolicy(
      envelope.prompt,
      this.policy,
      this.session,
    );
    this.emit(
      "input",
      envelope,
      combineActions(system.action, prompt.action),
      aggregateFindings(system.findings, prompt.findings),
    );

    return { systemPrompt: system.text, prompt: prompt.text };
  }

  private approveStrictInput(envelope: ContextEnvelope): ApprovedInput {
    const system = this.scanStrictInputText(envelope.systemPrompt);
    const prompt = this.scanStrictInputText(envelope.prompt);
    const findings = aggregateFindings(system.findings, prompt.findings);

    if (!system.result || !prompt.result) {
      this.emit("input", envelope, "blocked", findings);
      throw new TrustViolationError(findings);
    }

    this.emit("input", envelope, "allowed", findings);
    return { systemPrompt: system.result.text, prompt: prompt.result.text };
  }

  private scanStrictInputText(text: string): {
    findings: FindingSummary[];
    result?: TrustTextResult;
  } {
    try {
      const result = applySecretPolicy(text, "strict", this.session);
      return { findings: result.findings, result };
    } catch (error: unknown) {
      if (error instanceof TrustViolationError) {
        return { findings: error.findings };
      }
      throw error;
    }
  }

  private async generateTransport(
    envelope: ContextEnvelope,
    input: ApprovedInput,
    options: Omit<GenerateOptions, "systemPrompt">,
  ): Promise<string> {
    try {
      return await this.provider.generate(input.prompt, {
        ...options,
        systemPrompt: input.systemPrompt,
      });
    } catch (error: unknown) {
      this.throwSanitizedProviderError(envelope, error);
    }
  }

  private approveOutput(envelope: ContextEnvelope, output: string): string {
    try {
      const result = applySecretPolicy(output, this.policy, this.session);
      this.emit("output", envelope, result.action, result.findings);
      return result.text;
    } catch (error: unknown) {
      if (error instanceof TrustViolationError) {
        this.emit("output", envelope, "blocked", error.findings);
      }
      throw error;
    }
  }

  private throwSanitizedProviderError(
    envelope: ContextEnvelope,
    error: unknown,
  ): never {
    const diagnostic = error instanceof Error ? error.message : String(error);
    const findings = applySecretPolicy(
      diagnostic,
      "redact",
      new RedactionSession(),
    ).findings;
    this.emit("error", envelope, "blocked", findings);
    throw new Error(sanitizeDiagnostic(diagnostic));
  }

  private emit(
    stage: TrustEvent["stage"],
    envelope: ContextEnvelope,
    action: TrustEvent["action"],
    findings: FindingSummary[],
  ): void {
    const hook = this.eventHook;
    if (!hook) return;

    try {
      hook({
        stage,
        operation: envelope.operation,
        origin: this.origin,
        policy: this.policy,
        action,
        findings: findings.map(({ kind, count }) => ({ kind, count })),
      });
    } catch {
      // Trust events are best-effort and cannot change generation outcomes.
    }
  }
}

function combineActions(
  first: "allowed" | "warned" | "redacted",
  second: "allowed" | "warned" | "redacted",
): "allowed" | "warned" | "redacted" {
  if (first === "redacted" || second === "redacted") return "redacted";
  if (first === "warned" || second === "warned") return "warned";
  return "allowed";
}

function aggregateFindings(...groups: FindingSummary[][]): FindingSummary[] {
  const counts = new Map<FindingSummary["kind"], number>();

  for (const findings of groups) {
    for (const finding of findings) {
      counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + finding.count);
    }
  }

  return Array.from(counts, ([kind, count]) => ({ kind, count }));
}
