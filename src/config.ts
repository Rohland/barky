import path from "path";
import fs from "fs";
import { log } from "./models/logger";
import YAML from "yaml";
import { initLocaleAndTimezone } from "./lib/utility";
import * as process from "process";
import { EvaluatorType } from "./evaluators/base";
import { Muter } from "./muter";
import { initConnection } from "./models/db";

interface IConfigSettings {
    locale: string;
    timezone: string;
    port?: number;
}

interface IFileConfig {
    config: IConfigSettings;
    [key: string]: any;
}

export interface IConfig {
    [key: string]: any;
    fileName: string;
    env: IFileConfig;
}

function getFileNamePart(fileName: string) {
    const parts = fileName.split(/[\\\/]+/);
    const nameParts = parts[parts.length - 1].split(".");
    nameParts.pop();
    return nameParts.join(".");
}

function getConfigFileInfo(file: string, defaultExtension: string) {
    const hasYmlExtension = /\.ya?ml$/i.test(file);
    const yamlFilePath = hasYmlExtension ? file : `${ file }.${defaultExtension}`;
    const currentDir = process.cwd();
    const filePath = yamlFilePath.startsWith("/")
        ? yamlFilePath
        : path.join(currentDir, yamlFilePath);
    const fileName = getFileNamePart(yamlFilePath);
    return {
        filePath,
        fileName
    };
}

function getAndValidateConfigFileInfo(fileName: string) {
    let file = null;
    let fileInfo = getConfigFileInfo(fileName, "yaml");
    if (!fs.existsSync(fileInfo.filePath)) {
        fileInfo = getConfigFileInfo(fileName, "yml");
    }
    try {
        file = fs.readFileSync(fileInfo.filePath, 'utf8');
        if (!file) {
            throw new Error("Empty file");
        }
    } catch {
        const error = `no configuration file found or is empty - please inspect ${ fileInfo.filePath }`;
        log(`error: ${ error }`);
        throw new Error(error);
    }
    return { file, fileInfo };
}

function getConfigurationFromFile(
    file: string,
    fileInfo: { fileName: string; filePath: string }) {
    try {
        return tagConfigsWithFileMetaData(YAML.parse(file), fileInfo.filePath, true);
    } catch (err) {
        const error = `invalid yaml definition in file '${ fileInfo.filePath }'`;
        log(`error: ${ error }`);
        err.message = `${ error } - ${ err.message }}`;
        throw err;
    }
}

function explodeImports(env, fileInfo: { fileName: string; filePath: any }) {
    if (!Array.isArray(env.import)) {
        return;
    }
    env.import.forEach(x => {
        const dir = path.dirname(fileInfo.filePath);
        const importPath = path.join(dir, x);
        const importConfig = getConfig({ rules: importPath });
        Object.keys(EvaluatorType).forEach(type => {
            if (importConfig.env[type]) {
                env[type] ??= {};
                Object.assign(env[type], tagConfigsWithFileMetaData(importConfig.env[type], importPath, false));
            }
        })
    });
}

function tagConfigsWithFileMetaData(config: any, path: string, isRootFile: boolean) {
    if (!config) {
        return null;
    }
    const tagWhiteList = new Map(Object.keys(EvaluatorType).map(x => [x, true]));
    for (const key in config) {
        const item = config[key];
        if (typeof item === "object" && !Array.isArray(item)) {
            if (isRootFile) {
                if (tagWhiteList.has(key))
                {
                    tagConfigsWithFileMetaData(item, path, false);
                }
                continue;
            }
            item.__configPath = path;
        }
    }
    return config;
}

export async function initialiseGlobalConfig(args: any) {
    const config = getConfig(args);
    await initConnection(config.fileName);
    await Muter.getInstance().init(config.digest);
    return config;
}

export function getConfig(args: any): IConfig {
    const { file, fileInfo } = getAndValidateConfigFileInfo(args.rules);
    let env = getConfigurationFromFile(file, fileInfo);
    if (env.config) {
        initLocaleAndTimezone(env.config);
    }
    explodeImports(env, fileInfo);
    const digest = getDigestConfiguration(args);
    return {
        fileName: fileInfo.fileName,
        ...args,
        env,
        digest
    };
}

function getDigestConfiguration(args: any) {
    if (!args.digest) {
        return null;
    }
    const { file, fileInfo } = getAndValidateConfigFileInfo(args.digest);
    const config = getConfigurationFromFile(file, fileInfo);
    config.title ??= args.title ?? "";
    return config;
}
