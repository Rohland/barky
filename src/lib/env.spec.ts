import { getEnvVar } from "./env";

describe("env", () => {
    describe("with null/undefined key", () => {
        it("should return undefined", async () => {
            expect(getEnvVar(undefined)).toBeUndefined();
            expect(getEnvVar(null)).toBeUndefined();
        });
    });
    describe("with missing value", () => {
        it("should return default value", async () => {
            const val1 = getEnvVar("teseting123");
            expect(val1).toBeUndefined();
            const val2 = getEnvVar("testing123", "default");
            expect(val2).toBe("default");
        });
    });
    describe("with value", () => {
        it("should return it", async () => {
            process.env["valueset"] = "123";
            const val = getEnvVar("valueset");
            expect(val).toBe("123");
        });
    });
    describe("with dash in name", () => {
        it("should check underscore variants", async () => {
            process.env["testing_123_456"] = "value";
            const val = getEnvVar("testing-123-456");
            expect(val).toBe("value");
        });
    });
    describe("with underscore in name", () => {
        it("should check dash variants", async () => {
            process.env["testing-a1-b2"] = "value";
            const val = getEnvVar("testing_a1_b2");
            expect(val).toBe("value");
        });
    });
});
