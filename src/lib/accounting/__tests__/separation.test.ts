import { describe, it, expect } from "vitest";
import { separationOutcome, separationDisabled, separationError, SEPARATION_CODE } from "@/lib/accounting/separation";

const alice = "user-alice";
const bob = "user-bob";

describe("separationOutcome", () => {
  it("lets a different person approve, with the setting on or off", () => {
    for (const required of [true, false]) {
      expect(separationOutcome({ required, actorUserId: bob, involvedUserIds: [alice] })).toEqual({ allowed: true, selfApproved: false });
    }
  });

  it("refuses the person who raised it when a second approver is required", () => {
    expect(separationOutcome({ required: true, actorUserId: alice, involvedUserIds: [alice] })).toEqual({ allowed: false });
  });

  it("lets them through when it isn't required, but marks it as a self-approval", () => {
    expect(separationOutcome({ required: false, actorUserId: alice, involvedUserIds: [alice] })).toEqual({ allowed: true, selfApproved: true });
  });

  it("treats either of several involved people (a journal's creator or poster) as the same person", () => {
    expect(separationOutcome({ required: true, actorUserId: bob, involvedUserIds: [alice, bob] }).allowed).toBe(false);
    expect(separationOutcome({ required: true, actorUserId: bob, involvedUserIds: [bob, alice] }).allowed).toBe(false);
  });

  it("does not block when the creator is unknown (their account was deleted)", () => {
    expect(separationOutcome({ required: true, actorUserId: alice, involvedUserIds: [null, undefined] })).toEqual({ allowed: true, selfApproved: false });
  });

  it("has no one to be 'the same as' when the actor isn't a person", () => {
    expect(separationOutcome({ required: true, actorUserId: null, involvedUserIds: [alice] })).toEqual({ allowed: true, selfApproved: false });
    expect(separationOutcome({ required: true, actorUserId: null, involvedUserIds: [null] })).toEqual({ allowed: true, selfApproved: false });
  });
});

describe("separationDisabled", () => {
  it("is true only when it goes from on to off", () => {
    expect(separationDisabled({ requireSecondApprover: true }, { requireSecondApprover: false })).toBe(true);
    expect(separationDisabled({ requireSecondApprover: false }, { requireSecondApprover: true })).toBe(false);
    expect(separationDisabled({ requireSecondApprover: false }, { requireSecondApprover: false })).toBe(false);
    expect(separationDisabled({ requireSecondApprover: true }, {})).toBe(false); // not mentioned = unchanged
    expect(separationDisabled(null, { requireSecondApprover: false })).toBe(false);
  });
});

describe("separationError", () => {
  it("says what happened and what to do, with a code the screens can recognise", () => {
    const e = separationError("invoice", "approve");
    expect(e.code).toBe(SEPARATION_CODE);
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/raised this invoice, so someone else has to approve it/);
    expect(separationError("journal", "reverse").message).toMatch(/created or posted this journal/);
  });
});
