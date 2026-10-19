import { z } from "zod";
import { httpUrl } from "./_helpers";
import { passwordIssues } from "@/lib/password-policy";

export const UserRoleEnum = z.enum(["ADMIN", "PM", "CONTRIBUTOR", "VIEWER"]);

export const userSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: UserRoleEnum.default("CONTRIBUTOR"),
  avatarUrl: httpUrl.nullable().optional(),
  isActive: z.boolean().default(true),
});

// Context-free rules live on the field so a bad password is reported even when
// other fields fail; rules that need the user's own name/email run on the object.
const passwordField = z.string().superRefine((value, ctx) => {
  for (const message of passwordIssues(value)) ctx.addIssue({ code: "custom", message });
});

export const userCreateSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100),
    email: z.string().email("Valid email is required"),
    password: passwordField,
    role: UserRoleEnum.default("CONTRIBUTOR"),
  })
  .superRefine((data, ctx) => {
    // The context-free issues were already reported by the field; only add new ones.
    const known = new Set(passwordIssues(data.password));
    for (const message of passwordIssues(data.password, { email: data.email, name: data.name })) {
      if (!known.has(message)) ctx.addIssue({ code: "custom", message, path: ["password"] });
    }
  });

export const userUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: UserRoleEnum.optional(),
  isActive: z.boolean().optional(),
  // Checked against the user's own name/email by whoever applies the update (the schema can't see the existing row).
  password: passwordField.optional().or(z.literal("")),
});

export type UserInput = z.infer<typeof userSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
/** The first complaint about the `password` field, for a message a person can act on. */
export function firstPasswordMessage(error: z.ZodError): string | undefined {
  return error.issues.find((issue) => issue.path[0] === "password")?.message;
}
