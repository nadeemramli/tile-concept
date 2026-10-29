import { z } from "zod";
import { optionalUuid, uuid } from "@/lib/zod";

export const QUOTE_CHANNELS = ["whatsapp", "email", "in_person", "printed", "phone_call", "other"] as const;
export const QUOTE_SEND_EVIDENCES = ["staff_attested", "message_reference", "customer_acknowledged"] as const;
export const QUOTE_ORIGINS = ["inbox", "visit", "pipeline"] as const;
/** How far a new quote or revision has got when staff record it. */
export const QUOTE_STAGES = ["prepared", "issued", "sent"] as const;

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const optionalStr = (max = 200) => z.preprocess(blank, z.string().trim().max(max).optional());
const optionalMoney = z.preprocess(blank, z.coerce.number().finite().nonnegative("Enter zero or a positive amount").optional());
const optionalDate = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date").optional());
const time = (label: string) => z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`);

/**
 * `datetime-local` inputs are entered in showroom time, whatever the server's
 * timezone. A value that already carries an offset is kept as stated.
 */
export function showroomIso(value: string): string {
  const v = value.trim();
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(v) ? v : `${v.length === 16 ? `${v}:00` : v}+08:00`).toISOString();
}

const versionFields = {
  currency: z.string({ error: "Currency is required" }).trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency is required (three letters, for example MYR)"),
  total_amount: optionalMoney,
  external_ref: optionalStr(100),
  valid_until: optionalDate,
  notes: optionalStr(2000),
  prepared_at: optionalStr(40),
};

const sendFields = {
  sent_at: time("Send time"),
  channel: z.enum(QUOTE_CHANNELS, { error: "Choose how it was sent" }),
  evidence: z.enum(QUOTE_SEND_EVIDENCES, { error: "Choose the send evidence" }),
  evidence_ref: optionalStr(200),
  note: optionalStr(2000),
  sent_by: optionalUuid(),
};

const stageFields = {
  stage: z.enum(QUOTE_STAGES).default("prepared"),
  issued_at: optionalStr(40),
  sent_at: optionalStr(40),
  channel: z.preprocess(blank, z.enum(QUOTE_CHANNELS).optional()),
  evidence: z.preprocess(blank, z.enum(QUOTE_SEND_EVIDENCES).optional()),
  evidence_ref: optionalStr(200),
  send_note: optionalStr(2000),
};

const prepareInput = z.object({
  lead_id: optionalUuid(), visit_id: optionalUuid(), opportunity_id: optionalUuid(),
  origin: z.enum(QUOTE_ORIGINS),
  quote_number: optionalStr(60),
  ...versionFields,
  ...stageFields,
});

const reviseInput = z.object({ quote_id: uuid(), base_version_no: z.coerce.number().int().positive(), ...versionFields, ...stageFields });

const reason = z.string({ error: "A reason is required" }).trim().min(3, "A reason is required");

export const quoteCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), request_id: uuid(), input: prepareInput }),
  z.object({ action: z.literal("revise"), request_id: uuid(), input: reviseInput }),
  z.object({ action: z.literal("issue"), request_id: uuid(), input: z.object({ version_id: uuid(), issued_at: time("Issue time") }) }),
  z.object({ action: z.literal("send"), request_id: uuid(), input: z.object({ version_id: uuid(), ...sendFields, issue_if_prepared: z.boolean().default(false) }) }),
  z.object({ action: z.literal("void_send"), request_id: uuid(), input: z.object({ delivery_id: uuid(), reason }) }),
  z.object({ action: z.literal("accept"), request_id: uuid(), input: z.object({ quote_id: uuid(), reason: optionalStr(500) }) }),
  z.object({ action: z.literal("reject"), request_id: uuid(), input: z.object({ quote_id: uuid(), reason }) }),
  z.object({ action: z.literal("expire"), request_id: uuid(), input: z.object({ quote_id: uuid(), reason: optionalStr(500) }) }),
  z.object({ action: z.literal("reopen"), request_id: uuid(), input: z.object({ quote_id: uuid(), reason }) }),
  z.object({
    action: z.literal("resolve_evidence"), request_id: uuid(),
    input: z.object({
      visit_id: uuid(), file_id: optionalUuid(), expected_decision_id: optionalUuid(),
      resolution: z.enum(["link", "create_prepared", "unresolved", "not_a_quote"]),
      quote_id: optionalUuid(), version_id: optionalUuid(),
      currency: z.preprocess(blank, z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency is required").optional()),
      quote_number: optionalStr(60), reason: optionalStr(500),
    }).superRefine((v, ctx) => {
      if (v.resolution === "link" && !v.quote_id) ctx.addIssue({ code: "custom", path: ["quote_id"], message: "Choose the quote" });
      if (v.resolution === "create_prepared" && !v.currency) ctx.addIssue({ code: "custom", path: ["currency"], message: "Currency is required" });
      if ((v.resolution === "unresolved" || v.resolution === "not_a_quote") && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required" });
    }),
  }),
]);

export type QuoteCommand = z.infer<typeof quoteCommandSchema>;
export type QuoteAction = QuoteCommand["action"];

function compact<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
}

/**
 * The payload `api.quote_command` receives. Stage fields become nested
 * `issue` / `send` objects so preparing, issuing and sending stay separate
 * facts written in one transaction. Times are converted from showroom time.
 */
export function toQuoteRpcInput(command: QuoteCommand): Record<string, unknown> {
  switch (command.action) {
    case "prepare":
    case "revise": {
      const { stage, issued_at, sent_at, channel, evidence, evidence_ref, send_note, prepared_at, ...rest } = command.input;
      const out: Record<string, unknown> = compact({ ...rest, prepared_at: prepared_at ? showroomIso(prepared_at) : undefined });
      if (stage === "issued" || stage === "sent") {
        const issued = issued_at || (stage === "sent" ? sent_at : undefined);
        if (!issued) throw new QuoteInputError("issued_at", "Issue time is required");
        out.issue = { issued_at: showroomIso(issued) };
      }
      if (stage === "sent") {
        if (!sent_at) throw new QuoteInputError("sent_at", "Send time is required");
        if (!channel) throw new QuoteInputError("channel", "Choose how it was sent");
        if (!evidence) throw new QuoteInputError("evidence", "Choose the send evidence");
        out.send = compact({ sent_at: showroomIso(sent_at), channel, evidence, evidence_ref, note: send_note });
      }
      return out;
    }
    case "issue":
      return { version_id: command.input.version_id, issued_at: showroomIso(command.input.issued_at) };
    case "send": {
      const { sent_at, ...rest } = command.input;
      return compact({ ...rest, sent_at: showroomIso(sent_at) });
    }
    default:
      return compact(command.input);
  }
}

export class QuoteInputError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
  }
}
