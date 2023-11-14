import { execShellScript } from "./shell-runner";

describe("execShellScript", () => {
    describe("with simple script", () => {
        it("should execute and get result", async () => {
            // arrange
            const path = "../../tests/shell/simple.sh";
            const timeout = 1000;

            // act
            const result = await execShellScript(
                path,
                timeout);

            // assert
            expect(result.stdout).toEqual("hello");
            expect(result.exitCode).toEqual(0);
        });
    });
    describe("with simple script with args", () => {
        it("should execute and pass args", async () => {
            // arrange
            const path = "../../tests/shell/simple_args.sh";
            const timeout = 1000;

            // act
            const result = await execShellScript(
                path,
                timeout,
                ["hello", "world"]);

            // assert
            expect(result.stdout).toEqual("hello world");
            expect(result.exitCode).toEqual(0);
        });
    });
    describe("with script with error", () => {
        it("should execute and return error", async () => {
            // arrange
            const path = "../../tests/shell/error.sh";
            const timeout = 1000;

            // act
            const result = await execShellScript(
                path,
                timeout);

            // assert
            expect(result.exitCode).toEqual(127);
            expect(result.stdout).toContain("command not found");
        });
    });
    describe("when it takes too long", () => {
        it("should timeout with exit code 110", async () => {
            const path = "../../tests/shell/timeout.sh";
            const timeout = 1000;

            // act
            const result = await execShellScript(
                path,
                timeout);

            // assert
            expect(result.exitCode).toEqual(110);
            expect(result.stdout).toContain("TIMEOUT");
        });
    });
});
