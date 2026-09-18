import { describeError } from "./error.js";
import { SlackApiError } from "../models/channels/slack-api.js";

describe("describeError", () => {
    describe("a plain error", () => {
        it("should read as its message", async () => {
            expect(describeError(new Error("it broke"))).toEqual("it broke");
        });
    });
    describe("a wrapped error", () => {
        it("should name the reason as well as the wrapper", async () => {
            // arrange - the wrapper is all an operator sees, and on its own it names nothing to
            // go and fix
            const cause = new SlackApiError("message_not_found");
            const err = new Error("Error executing posting to slack after 1 attempt", { cause });

            // act
            const result = describeError(err);

            // assert
            expect(result).toEqual(
                "Error executing posting to slack after 1 attempt: slack rejected the request: message_not_found");
        });
        it("should not repeat a reason the wrapper already states", async () => {
            // arrange
            const cause = new Error("timeout of 5000ms exceeded");
            const err = new Error("posting failed: timeout of 5000ms exceeded", { cause });

            // act
            const result = describeError(err);

            // assert
            expect(result).toEqual("posting failed: timeout of 5000ms exceeded");
        });
        it("should follow the whole chain", async () => {
            const inner = new Error("econnreset");
            const middle = new Error("request failed", { cause: inner });
            const outer = new Error("giving up", { cause: middle });
            expect(describeError(outer)).toEqual("giving up: request failed: econnreset");
        });
    });
    describe("a chain that loops", () => {
        it("should stop rather than run away", async () => {
            // arrange
            const a: any = new Error("a");
            const b: any = new Error("b", { cause: a });
            a.cause = b;

            // act
            const result = describeError(a);

            // assert
            expect(result).toContain("a: b");
            expect(result.length).toBeLessThan(200);
        });
    });
    describe.each([
        ["a string", "just text", "just text"],
        ["nothing", null, ""],
        ["undefined", undefined, ""],
        ["an error with no message", new Error(), "Error"]
    ])("given %s", (_label, err, expected) => {
        it("should describe it without throwing", async () => {
            expect(describeError(err)).toEqual(expected);
        });
    });
});
