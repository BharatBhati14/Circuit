import z from "zod";
import type { WorkflowNode } from "@circuit/contracts";
import { InvalidWorkflowError } from "../errors.js";

const emptyConfigSchema = z.object({}).strict();

const httpRequestConfigSchema = z
  .object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string().url(),

    headers: z.record(z.string(), z.string()).optional(),

    body: z.unknown().optional(),

    timeoutMs: z.number().int().min(1000).max(30000).optional(),
  })
  .strict()
  .superRefine((config, context) => {
    try {
      const parsedUrl = new URL(config.url);

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        context.addIssue({
          code: "custom",
          path: ["url"],
          message: "URL must use HTTP or HTTPS.",
        });
      }

      if (parsedUrl.username || parsedUrl.password) {
        context.addIssue({
          code: "custom",
          path: ["url"],
          message: "URL must not contain embedded credentials.",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "URL must be a valid absolute HTTP or HTTPS URL.",
      });
    }

    if (
      ["GET", "DELETE"].includes(config.method) &&
      config.body !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: `${config.method} requests must not include a body.`,
      });
    }

    if (
      config.body !== undefined &&
      (config.body === null ||
        typeof config.body !== "object" ||
        Array.isArray(config.body))
    ) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "Body must be a JSON object.",
      });
    }
  });

const dataTransformConfigSchema = z
  .object({
    mappings: z.record(z.string(), z.string()),
  })
  .strict();

export const conditionRuleSchema = z.object({
  field: z.string().min(1, "Field path is required"),

  operator: z.enum([
    "equals",
    "not_equals",
    "contains",
    "greater_than",
    "less_than",
  ]),

  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const conditionConfigSchema = z.object({
  rules: z.array(conditionRuleSchema).min(1, "At least one rule is required"),

  logicalOperator: z.enum(["AND", "OR"]).default("AND"),
});

export const delayConfigSchema = z.object({
  durationMs: z
    .number()
    .positive("Delay duration must be a positive number of milliseconds"),
});

export const loopConfigSchema = z.object({
  itemsPath: z
    .string()
    .min(1, "Items path is required (e.g. $.nodeId.arrayField)"),
  batchSize: z.number().int().positive().optional().default(1),
});

const nodeConfigSchemas = {
  manual_trigger: emptyConfigSchema,
  webhook_trigger: emptyConfigSchema,
  schedule_trigger: emptyConfigSchema,
  http_request: httpRequestConfigSchema,
  data_transform: dataTransformConfigSchema,
  condition: conditionConfigSchema,
  delay: delayConfigSchema,
  loop: loopConfigSchema,
} as const;

export function validateNodeConfig(node: WorkflowNode): void {
  const schema = nodeConfigSchemas[node.type];
  const result = schema.safeParse(node.config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.length ? issue.path.join(".") : "config";

        return `${path}: ${issue.message}`;
      })
      .join("; ");

    throw new InvalidWorkflowError(
      `Invalid configuration for node "${node.id}" (${node.type}): ${details}`,
    );
  }
}
