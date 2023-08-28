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
import { Argv } from "yargs";

(async () => {
    const args = await getArgs();
    const exitCode = await loop(args, () => run(args));
    process.exit(exitCode);
})();

async function run(args) {
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
    const { file, fileInfo } = getAndValidateConfigFileInfo(args.rules);
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
    function cmdBuilder(yargs: Argv) {
        yargs
            .positional("rules", {
                type: "string",
                description: "path to the evaluator configuration yaml file",
                required: true
            })
            .option("eval", {
                description: "Comma separated list of evaluators to run - if not provided, all are evaluated",
                type: "string",
            })
            .option("digest", {
                description: "Run the digest step using the configuration file set with this argument",
                type: "string"
            })
            .option("title", {
                description: "When set, is used in notifications using variable {{ title }}",
                type: "string",

            })
            .implies('title', 'digest')
            .option("debug", {
                description: "If set, debug messages are printed to the console",
                type: "boolean"
            });
    }

    const args = await yargs(hideBin(process.argv))
        .usage("$0 <cmd> [options]")
        .command("run <rules> [options]", "run the watchdog", cmdBuilder)
        .command("loop <rules> [options]", "run the watchdog in a loop until terminated", cmdBuilder, configureLoop)
        .command("killall", "kills all running barky processes", killAll)
        .demandCommand()
        .example("$0 run client", "run all evaluators using ./client.yaml")
        .example("$0 run client --eval=mysql", "runs the mysql evaluator only")
        .example("$0 run client --eval=web,mysql", "only runs mysql & web evaluators")
        .example("$0 run client --digest=my-team --title='ACME'", "runs all evaluators and uses my-team config for digest")
        .example("$0 loop client", "runs in a loop (every 30 seconds) until exit")
        .help()
        .argv;
    return args;
}

function killAll() {
    console.log("killing all barky processes");
    const candidates = fs.readdirSync(path.join(path.dirname('')), { withFileTypes: true })
        .filter(x => /^\.barky.*\.lock$/.test(x.name))
        .map(x => ({ file: x, contents: fs.readFileSync(x.name, 'utf8') }))
        .map(data => {
            const fileParts = data.contents.split(' ');
            return {
                ...data,
                pid: parseInt(fileParts[0]),
                details: fileParts[1].trim()
            };
        })
        .filter(data => Number.isInteger(data.pid));
    console.log(`found ${ candidates.length } local barky processes`);
    candidates
        .forEach(data => {
            console.log(`killing barky pid ${ data.pid } (${ data.details }) - ${ data.file.name }`);
            try {
                process.kill(data.pid, -9);
            } catch(err) {
                // no-op
            }
            fs.unlinkSync(data.file.name);
        });
    process.exit(0);
}

function configureLoop(yargs: any) {
    yargs.loop = true;
}
