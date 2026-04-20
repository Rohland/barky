// @ts-ignore
import { jest } from '@jest/globals';
import path from 'path';
import * as util from 'node:util';
import { fileURLToPath } from "node:url";

export function getCallerDir() {
    if (typeof util.getCallSites !== "function") {
        // when jest is running in an isolated vm, util.getCallSites is sometimes
        // not available (for some reason), if that's the case, rely on the error stack
        // to get us the caller's path
        return getCallerDirUsingErrorStack();
    }
    const callSites = util.getCallSites();
    return path.dirname(callSites[2].scriptName);
}

export function getCallerDirUsingErrorStack() {
    const err = new Error();
    const stack = err.stack?.split("\n")[4]; // line 4 is the caller
    const match = stack?.match(/\((.*):\d+:\d+\)/) || stack?.match(/at (.*):\d+:\d+/);
    const callerFile = match?.[1];
    if (!callerFile) {
        throw new Error("Failed to determine caller file");
    }
    return path.dirname(fileURLToPath(`file://${callerFile}`));
}

/*
 * Imports the actual module and applies the provided factory to mock specific exports. This is useful when you want to
 * mock only certain parts of a module while keeping the rest of its functionality intact.
 */
export async function importActualAndMock<T = any>(
    modulePath: string,
    factory?: Partial<T> | (() => Partial<T>)): Promise<T> {
    return importAndMock<T>(
        modulePath,
        factory,
        true);
}

/*
 * Mocks the given module path using the provided factory. If the module path is relative, it will be resolved
 * based on the caller's directory. When using this, make sure to import the module that uses the mocked module
 * after calling this function, otherwise the original module will be cached and used instead of the mocked one.
 * When doing so, you need to use await import(...) to ensure the module is imported after the mock is set up.
 *
 * Example usage:
 *
 * const myModule = await importAndMock<MyModuleType>(
 *     "./path/to/myModule",
 *    {
 *         myFunction: jest.fn().mockReturnValue("mocked value")
 *     });
 * const moduleThatUsesMyModule = await import("./path/to/moduleThatUsesMyModule");
 */
export async function importAndMock<T = any>(
    modulePath: string,
    factory?: Partial<T> | (() => Partial<T>),
    // if set to true, the original module will be included and the factory will just override the specified exports
    includeActual: boolean = false
): Promise<T> {
    if (modulePath.startsWith(".")) {
        modulePath = path.join(getCallerDir(), modulePath);
    }
    let original = null;
    if (includeActual) {
        original = await import(modulePath);
    }
    jest.unstable_mockModule(modulePath, () => {
        const mockedModule = typeof factory === 'function' ? (factory as any)() : (factory ?? {})
        if (includeActual) {
            return { ...original, ...mockedModule };
        }
        return mockedModule;
    });
    let mod: T;
    await jest.isolateModulesAsync(async () => {
        if (includeActual) {
            jest.resetModules();
        }
        mod = (await import(modulePath)) as unknown as T;
    });
    return mod!;
}
