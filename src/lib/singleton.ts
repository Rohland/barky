const registeredSingletons = new Map<string, any>();

export function singleton<T>(name: string, factory: () => T): T {
    if (!name || name.trim() === "" ){
        throw new Error("name is required");
    }
    let instance = registeredSingletons.get(name);
    if (instance) {
        return instance;
    }
    instance = factory();
    registeredSingletons.set(
        name,
        instance);
    return instance;
}

export function findSingletonByPrefix<T>(prefix: string): T {
    for (const [key, value] of registeredSingletons) {
        if (key.startsWith(prefix)) {
            return value;
        }
    }
    return null;
}

export function deregisterSingletonsByPrefix(prefix: string): void {
    for (const key of registeredSingletons.keys()) {
        if (key.startsWith(prefix)) {
            registeredSingletons.delete(key);
        }
    }
}

export function deregisterSingleton(name: string): void {
    if (!name || name.trim() === "" ){
        throw new Error("name is required");
    }
    registeredSingletons.delete(name);
}

export async function asyncSingleton<T>(name: string, factory: () => Promise<T>): Promise<T> {
    if (!name || name.trim() === "" ){
        throw new Error("name is required");
    }
    let instance = registeredSingletons.get(name);
    if (instance) {
        return instance;
    }
    instance = await factory();
    registeredSingletons.set(
        name,
        instance);
    return instance;
}
