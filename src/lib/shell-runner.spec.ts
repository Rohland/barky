import { execShellScript, resetShellEnvironment } from "./shell-runner";
import path from "path";

describe("execShellScript", () => {
    describe("with simple script", () => {
        it("should execute and get result", async () => {
            // arrange
            const file = "../../tests/shell/simple.sh";
            const timeout = 1000;

            // act
            const result = await execShellScript(
                path.resolve(__dirname, file),
                timeout);

            // assert
            expect(result.stdout).toEqual("hello");
            expect(result.exitCode).toEqual(0);
        });
    });
    describe("with simple script with args", () => {
        it("should execute and pass args", async () => {
            // arrange
            const file = "../../tests/shell/simple_args.sh";
            const timeout = 1000;

            // act
            const result = await execShellScript(
                path.resolve(__dirname, file),
                timeout,
                ["hello", "world"]);

            // assert
            expect(result.stdout).toEqual("hello world");
            expect(result.exitCode).toEqual(0);
        });
    });
    describe("with environment variables", () => {
        it("should emit them for use in the script, renaming appropriately", async () => {
            // arrange
            const file = "../../tests/shell/env.sh";
            const timeout = 1000;
            resetShellEnvironment();
            process.env["my-var"] = "a";
            process.env["anothervar"] = "b";

            // act
            const result = await execShellScript(
                path.resolve(__dirname, file),
                timeout);

            // assert
            expect(result.stdout).toEqual("a b");
            expect(result.exitCode).toEqual(0);
        });
    });
    describe("with script with error", () => {
        it("should execute and return error", async () => {
            // arrange
            const file = "../../tests/shell/error.sh";
            const timeout = 1000;

            // act
            const result = await execShellScript(
                path.resolve(__dirname, file),
                timeout);

            // assert
            expect(result.exitCode).toEqual(127);
            expect(result.stdout).toContain("command not found");
        });
    });
    describe("when it takes too long", () => {
        it("should timeout with exit code 110", async () => {
            const file = "../../tests/shell/timeout.sh";
            const timeout = 1000;

            // act
            const result = await execShellScript(
                path.resolve(__dirname, file),
                timeout);

            // assert
            expect(result.exitCode).toEqual(110);
            expect(result.stdout).toContain("TIMEOUT");
        });
    });
});
