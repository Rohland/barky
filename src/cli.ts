#!/usr/bin/env node
import * as Dotenv from "dotenv";
Dotenv.config();
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import YAML from 'yaml';
import fs from 'fs';
import path from 'path';
import { MonitorFailureResult } from "./models/result";
import { destroy } from "./models/db";
import { emitAndPersistResults, execute } from "./exec";
import { initLocaleAndTimezone } from "./lib/utility";
import { loop } from "./loop";
import { initLogger, log } from "./models/logger";

(async () => {
    const args = await getArgs();
    const exitCode = await loop(args, () => run(args));
    process.exit(exitCode);
})();

async function run(args){
    initLogger(args);
    try {
        const config = getConfig(args);
        log(`starting ${ args.eval } evaluators`);
        await execute(
            config,
            args.eval);
        return 0;
    } catch (err) {
        log(err, err);
        // emits a global config error - assume cloud watch monitor is set up for this as a safety net
        const result = new MonitorFailureResult(
            "watchdog",
            "configuration",
            err.message);
        await emitAndPersistResults([result]);
        return -1;
    } finally {
        await destroy();
    }
}

function getFileNamePart(fileName: string) {
    const parts = fileName.split(/[\\\/]+/);
    const nameParts = parts[parts.length - 1].split(".");
    nameParts.pop();
    return nameParts.join(".");
}

function getConfigFileInfo(file) {
    const yamlFileName = file.toLowerCase().endsWith(".yaml") ? file : `${ file }.yaml`;
    const filePath = path.join(path.dirname(''), yamlFileName);
    const fileName = getFileNamePart(yamlFileName);
    return {
        filePath,
        fileName
    }
}

function getAndValidateConfigFileInfo(fileName) {
    let file = null;
    const fileInfo = getConfigFileInfo(fileName);
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

function getConfigurationFromFile(file, fileInfo: { fileName: string; filePath: string }) {
    try {
        return YAML.parse(file);
    } catch (err) {
        const error = `invalid yaml definition in file '${ fileInfo.filePath }'`;
        log(`error: ${ error }`);
        err.message = `${ error } - ${ err.message }}`;
        throw err;
    }
}

function getConfig(args) {
    const { file, fileInfo } = getAndValidateConfigFileInfo(args.env);
    const env = getConfigurationFromFile(file, fileInfo);
    if (env.config) {
        initLocaleAndTimezone(env.config);
    }
    const digest = getDigestConfiguration(args);
    return {
        fileName: fileInfo.fileName,
        ...args,
        env,
        digest
    };
}

function getDigestConfiguration(args) {
    if (!args.digest) {
        return null;
    }
    const { file, fileInfo } = getAndValidateConfigFileInfo(args.digest);
    const config = getConfigurationFromFile(file, fileInfo);
    config.title ??= args.title ?? "";
    return config;
}

async function getArgs() {
    const args = await yargs(hideBin(process.argv))
        .usage("$0 [options]")
        .option("debug", {
            description: "If set, debug messages are printed to the console",
            type: "boolean"
        })
        .option("eval", {
            description: "Comma separated list of evaluators to run",
            type: "string",
        })
        .option("env", {
            description: "The path to the yaml configuration file to use",
            type: "string"
        })
        .option("digest", {
            description: "If set, the results will be processed with configured digest file",
            type: "string"
        })
        .option("loop", {
            description: "If set, the app runs in a loop (every 30 seconds) until exit",
            type: "boolean"
        })

        .option("title", {
            description: "When set, is used in notifications using variable {{ title }}",
            type: "string"
        })
        .example("$0 --env=client", "run all evaluators using ./client.yaml")
        .example("$0 --eval=mysql --env=client", "runs the mysql evaluator only")
        .example("$0 --eval=web,mysql --env=client", "only runs mysql & web evaluators")
        .example("$0 --env=client --digest=my-team --title='ACME'", "runs all evaluators and uses my-team config for digest")
        .example("$0 --env=client --loop", "runs in a loop (every 30 seconds) until exit")
        .demandOption("env")
        .help("h")
        .alias("h", "help")
        .argv;
    return args;
}
