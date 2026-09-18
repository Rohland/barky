# Barky - Cloud Watchdog
_Warning: Currently in alpha, use at own risk_

![Barky](./assets/barky.png)

Barky is intended to run custom monitoring in a simple and effective way, using a tool with no external dependencies (like databases) in order to drive effective alert/outage notifications.

**What problem does this solve?**

Standard alerting systems can be noisy and overwhelming, sending hundreds of notifications when issues arise. With Barky’s digest feature, you get a single alert with all the key details and updates as the situation changes. You’ll be notified when the issue is resolved and receive updates at a frequency you control, keeping you informed without the overload.

**What does this do?**

It runs a custom set of evaluators (configured in simple markup using YAML) with (current) support for the following checks:

- **web**: Evaluate any accessible site and validate status code, response time, TLS certificate (including upcoming expiry) and optionally response content (response includes, regular expression matches and JSON evaluation)
- **sumo**: Runs custom Sumo Logic queries and evaluates results based on validator configuration
- **mysql**: Runs custom mysql queries and evaluates results based on trigger configuration
- **shell**: Runs a custom shell script and evaluates results based on trigger configuration

Evaluations supported:

- Consecutive failures - trigger after a given number of consecutive failures
- Failures in window period - trigger after a given number of failures in a sliding window period

The results of the evaluators are emitted via `stdout` using a pipe delimited format (per monitor). This can be logged and ingested into any cloud log management tool for tracking.

In addition to this, the results are evaluated and alerts emitted in a digest format via the following supported channels:

- SMS
- Slack

So, the pipeline is `Evaluate > Digest` where the evaluation emits status of things monitored and the digest step emits any alerts (triggered, ongoing or resolution) via the configured channels. The digest step is optional.

Alerts can be muted from the dashboard, or from Slack itself - see [Chat Ops](#chat-ops-slack).

## Usage

Commands:

- `run` - runs the evaluator
- `loop` - runs the evaluator in a loop (every 30s) until terminated
- `killall` - kills all running barky processes based on lock files in the current directory

```bash
# run the evaluator without digest
npx barky@latest run configs/my.yaml

# run the evaluator with specific evaluator (comma separate for more)
npx barky@latest run configs/my.yaml --eval=web

# run the evaluator and digest step
npx barky@latest run configs/my.yaml --digest=configs/digest/my-team.yaml --title="ACME Public"

# run in a loop (every 30s) until exit
npx barky@latest loop configs/my.yaml --digest=configs/digest/my-team.yaml --title="ACME Public"

# bypass prompt for package installation
npx --yes barky@latest run configs/my.yaml --eval=web --digest=configs/digest/my-team.yaml --title="ACME Public"
```

## Evaluation

#### Configuration

Evaluator configuration is managed via a YAML file which is referenced via a CLI command argument. 

The `config` keyword in the YAML file defines locale and timezone as per the example below:

```yaml
config:
  locale: en-ZA
  timezone: Africa/Johannesburg
  port: 3000 # the port to run the web UI on (defaults to HTTP_PORT env var, otherwise 3000)
```

The following high level keys are supported (note, it is case sensitive):

- web
- sumo
- mysql
- shell

For convenience, you can store rules in separate yaml files and include them as follows. Note that paths should be relative to parent.

```yaml
import:
  - rules/web.yaml
  - rules/sumo.yaml
  - rules/mysql.yaml
```

##### Evaluator Basics

For each evaluator, a ping is emitted to `stdout` with information about what type was evaluated, and how many were evaluated.

Example:

```
# date|type|label|identifer|success|result_text|result|time_taken
2023-08-25T13:17:24.471Z|web|monitor|ping|1|7 evaluated|7|132.78
```

In addition, each evaluator app supports the following properties:

- `name` - String - a friendly name for the relevant app
- `quiet` - Any - if set to a truthy value, will suppress success output
- `timeout` - Numeric - a value in milliseconds (example: 10000 for 10s)
- `vary-by` - Array<string|string[]> - enables variations of fields like name, url, path, query, connection or alert.channels items 
- `every` - String or Array&lt;String&gt; - how often to evaluate the rule. Two forms are supported:
    - a duration, defaults to "30s" - value must be multiples of 30s, examples: 60s, 90s, 10m, 1h (only applicable in loop mode)
    - an explicit time of day in 24 hour format, examples: 5:00, 05:00, 5:00:30, or a list of times like [5:00, 19:00] - the rule is then only evaluated at those times (see below)
- `except-at` - String or Array&lt;String&gt; - a time range, or list of time ranges, during which the rule is not evaluated at all, examples: 09:00-11:00, or [9:00-11:00, 17:00-23:00] (see below)

###### Variations

Examples of vary-by:

```yaml
web:
  www.codeo.co.$1:
    vary-by: [za,us,gb]
    url: https://www.codeo.co.za/en-$1 
```

This will generate 3 apps to be evaluated with:

```
names: [www.codeo.co.za, www.codeo.co.us, www.codeo.co.gb]
urls: [https://www.codeo.co.za/en-za, https://www.codeo.co.za/en-us, https://www.codeo.co.za/en-gb]
```

A more complex example:

```yaml
web:
  www.codeo.co.$1:
    vary-by: 
      - [za, zar]
      - [com, usd]
    url: https://www.codeo.co.$1/currency=$2
```

This would generate 2 apps to be evaluated with:

```
names: [www.codeo.co.za, www.codeo.com]
urls: [https://www.codeo.co.za/currency=zar, https://www.codeo.com/currency=usd]
```

###### Scheduling at explicit times

Instead of a duration, `every` accepts an explicit time of day, or a list of times. The rule is then only
evaluated at those times, which is useful for checks that only make sense once or twice a day - a nightly
batch job having completed, for example.

```yaml
web:
  # evaluated once a day, at 5AM
  overnight-batch:
    url: https://www.codeo.co.za/batch-status
    every: 5:00
  # evaluated twice a day, at 5AM and 7PM
  twice-daily:
    url: https://www.codeo.co.za/status
    every: [5:00, 19:00]
```

Notes:

- Times are in 24 hour `HH:mm` or `HH:mm:ss` format. A leading zero is optional, so `5:00` and `05:00` are
  equivalent. Quoting the value is not necessary.
- Times are resolved in the timezone configured under `config.timezone`, consistent with the `days` and
  `time` fields on trigger rules.
- The rule is evaluated once per configured time, per day.
- Because the loop ticks every 30 seconds and is not aligned to wall clock boundaries, a rule is considered
  due for the minute that starts at the configured time. `every: 5:00` therefore evaluates on the first tick
  between 05:00:00 and 05:00:59. Note that this state is held in memory, so restarting barky within that
  minute can evaluate the rule a second time.
- Unlike durations, explicit times are also honoured in `run` mode, so a `barky run` outside of the window
  reports the check as skipped. This makes it possible to drive barky from cron rather than in loop mode.
- Durations and explicit times cannot be mixed in the same list - `every: [5:00, 1h]` is an error.

###### Excluding periods of the day

`except-at` defines a blackout window - a time range, or list of time ranges, during which the rule is not
evaluated at all. This is useful for checks that are expected to fail during a known maintenance or batch
window, where alerting is noise rather than signal.

```yaml
web:
  # not evaluated between 9AM and 11AM
  maintenance-window:
    url: https://www.codeo.co.za/status
    every: 5m
    except-at: 09:00-11:00
  # not evaluated between 9AM and 11AM, nor between 5PM and 11PM
  two-windows:
    url: https://www.codeo.co.za/status
    except-at: [9:00-11:00, 17:00-23:00]
  # not evaluated overnight - ranges may wrap past midnight
  overnight:
    url: https://www.codeo.co.za/status
    except-at: 23:00-02:00
```

Notes:

- Ranges are `HH:mm-HH:mm` in 24 hour format. A leading zero is optional and spaces around the dash are
  allowed, so `9:00-11:00` and `09:00 - 11:00` are both valid. Quoting the value is not necessary.
- Ranges are resolved in the timezone configured under `config.timezone`, consistent with `every` and with
  the `days` and `time` fields on trigger rules.
- Both ends of the range are inclusive, so `09:00-11:00` suppresses the check from 09:00:00 up to and
  including 11:00:00.
- A range whose end is before its start wraps past midnight - `23:00-02:00` covers 11PM through 2AM.
- `except-at` takes precedence over `every`, and it applies in `run` mode as well as `loop` mode.
- A blackout **cancels** any run that falls inside it - it does not defer it. If a rule is scheduled at an
  explicit time that the window covers, that run is lost for the day rather than happening once the window
  lifts. For example `every: [5:00, 22:00]` combined with `except-at: 21:00-23:00` evaluates only at 5AM;
  the 10PM run never happens. Interval-based rules simply resume on their normal cadence after the window.
- Blacked out checks are reported as skipped, which suppresses their alerts in the digest, rather than being
  recorded as failures.

##### Web Configuration

Simple example:

```yaml
config:
  locale: en-ZA
  timezone: Africa/Johannesburg

web:
  www.codeo.co.za:
    url: https://www.codeo.co.za
```

This will trigger a check against www.codeo.co.za, and will validate that a 200 status code is returned. It will automatically include a `__barky={timestamp}` querystring parameter to bust any caching and will also submit with user agent `barky`.

Example successful output:

```
# date|type|label|identifer|success|result_text|result|time_taken
2023-08-23T15:05:53.554Z|web|health check|www.codeo.co.za|1|OK|200|184.70
```

Example failure output:

```
# date|type|label|identifer|success|result_text|result|time_taken
2023-08-23T15:07:35.339Z|web|health check|www.codeo.co.za|0|Expected status:200,received 500|500|86.43
```

If there is a problem with global configuration, you can expect a monitor output like this:

```
2023-08-23T15:08:56.172Z|watchdog|monitor|configuration|0|invalid yaml definition in file 'configs/test.yaml' - Implicit keys need to be on a single line at line 4, column 1:   timezone: Africa/Johannesburg @asd ^ }||0.00
```

If there is a problem with an evaluator, you can expect a monitor output like this:

```
# date|type|label|identifer|success|result_text|result|time_taken
2023-08-23T15:13:33.467Z|web|monitor|www.codeo.co.za|0|missing url for web app 'www.codeo.co.za'||0.00
```

You can get further information about any error by running the tool using the `--debug` switch or setting DEBUG env var to 1 or true.


Additional values that can be configured:

- `method` defaults to `get`
- `status` defaults to 200
- `max-redirects` defaults to 5 - set to 0 to disable redirects
- `timeout` defaults to 5000 (5 seconds)
- `headers` - a custom set of headers (see example below) - these can include environment variables using $ prefix
- `vary-by` - enables variations of a given url, an instance for each variation is monitored
- `triggers` - a list of custom response triggers (expect values to be truthy to pass)
  - `text` - a string to search for in the response body (case-insensitive)
  - `json`- a JavaScript expression to evaluate on the JSON data returned by the request 
  - `match` - a regular expression to match against the response body
- `alert` - defines the alert rules, see below
- `tls` - if property is missing, the defaults below apply
  - `verifiy` - defaults to true, set to false to disable all certificate verification
  - `expiry` - defaults to `7d` (7 days) - will alert if certificate expires within this period

**Alerts**

Fields:

* `channels` - an array of channels to use (example: `[sms, slack]`)
* `links` - optional array of links to include when alerts trigger
* `rules` - an array of rules (the first matched rule will always be used) - if `match` expression is used, only rules matching the expression will be evaluated
  * `description` - not required
  * `count|any` - count means trigger after defined consecutive count of errors, any means trigger after `any` count of errors in the window period defined
  * `window` - not required, but useful to constrain `any` operator to the given window, example: `-30m` means last 30 minutes. Maximum window is `24h`. Defaults to 5 minutes if not specified
  * `match` - an optional match expression to match against the monitor identifier (see below for format)
  * `days` - array of days and only required if you want to constrain the trigger to specific days of week (see example)
  * `time` - array or single range value, only required if you want to constrain the trigger to specific times of the day (times are in the timezone specified in the config)
* `exception-policy` - the name of the alert policy (defined in the digest configuration) to use for monitor failures (such as timeouts or exceptions), if not set then the same alert configuration rules defined above will be used when the monitor incurs an unhandled error

The match expression is composed as follows: `type::label::identifier`. For example: `web::web-performance::www.codeo.co.za`. The regular expression for match
will thus be compared against this string value (case-insensitive).

Advanced example:

```yaml
config:
  locale: en-ZA
  timezone: Africa/Johannesburg

web:
  www.codeo.co.za.$1:
    vary-by: [za,us,gb]
    url: https://www.codeo.co.za/en-$1 # the vary-by instance value is captured into $1
    status: 200
    timeout: 10000
    max-redirects: 0 # don't follow redirects
    headers:
      Authorization: $my-auth-token # uses environment variable my-auth-token
      x-my-custom-value: "123"
    triggers:
      # either match, text or json can be used (in conjunction if necessary)
      - text: ok # this checks the response contains the text "ok"
        message: Expected to find text "ok" in response but didn't
      - match: "\\d+" # this checks the response matches the regex
        message: Expected to find a numeric valid in the response, but didn't
      # for json responses, the response is parsed and the expression is evaluated against the parsed object
      # for example a response of { "result": 123 } could be evaluated with `result > 100`
      # if the key has non-alpha-numeric values, these are replaced with underscore, i.e. 
      # { "my-key": 123 } would be accessed with `my_key`; note that sub-properties can also
      # be dereferenced using normal notation (i.e. `my_key.sub_key > 123`)
      - json: someKey.result > 100  # this checks the response is valid json and matches the expression
        # note that the message can include an evaluation of properties on the json result, see below
        message: "Expected someKey.result to be greater than 100 but was {{someKey?.result ?? 'unknown'}}"
    alert: 
        channels: [sms, slack]
        links:
          - label: Playbook
            url: "https://notion.so"
        rules:
            - description: Weekdays
              match: .*
              count: 2 # any consecutive 2 failures trigger alert
              days: [mon, tue, wed, thu, fri]
              time: [00:00-04:00, 6:00- 17:00] # local time as per timezone
            - description: Weekends
              match: .*
              window: -5m
              any: 3
              days: [sat, sun]
              time: 04:00 - 17:00
```

##### Sumo Logic Configuration

The Sumo Logic evaluator supports two modes: logs, metrics (default mode is logs).


**Log Evaluator**

The example below will search Sumo Logic using the given query, and iterate over the result set. The time window
searched is specified by `period`. 

The `triggers` define the set of rules that will trigger alerts. The first trigger that matches the value for the identifier will be selected and evaluated.
The trigger's rule expression is evaluated as JavaScript.

For Sumo Logic queries, the default domain is `api.eu.sumologic.com` - however, this can be overridden using an 
environment variable called `sumo-domain`.

The example below does not have any alerts configured, see web example above to see what you can do with alerts.

```yaml
sumo:
  web-performance:
    name: web-performance
    quiet: true # successful evaluation is suppressed
    token: sumo-token # the tool will expect an environment variable with a token using this key (see more about this below)
    period: -10m to -0m
    query: >
      # this query gets 90th percentile response time, and error rate for sites with traffic in the last 10 minutes
      _sourceCategory=system/linux/nginx _collector=*mycollector* not(host=*test*)
      | if(status matches "5*", 1, 0) as error
      | if(status matches "5*", 0, 1) as ok
      | where responsetime >= 0
      | pct(responsetime, 90) as _90p, sum(error) as error, sum(ok) as ok, count by host
      | where _count > 10
      | error / _count * 100 as error_rate
      | host as site
      | _90p as response_time
      | fields site, response_time, error_rate
      | order by response_time desc, error_rate desc
    # identifier: string | string [] - plucks the values from each result entry as the identifier (should be unique),
    # if an array is specified, the values are plucked and concatenated with a : separator
    # if the identifier is not configured, the identifier defaults to the name of the monitor, and if multiple rows 
    # are returned, each result is emitted with a unique incrementing suffix (starting from 1)
    identifier: site 
    # fill - an optional array of entries to fill in the result set to evaluate (if missing from the query); if the
    # identifier is an array, the identifier values in the fill need to be an array as well, in the same order,
    # for example: 
    #  identifier: [site, scheme]
    #  fill:
    #    - identifier [somesite.com, https]
    fill:
      - identifier: somesite.com
        response_time: 100
    triggers:
      - match: myslowsite\.(com|net) # special rules for myslowsite.com and myslowsite.net
        rules:
          - expression: response_time >= 2
            message: "Response time is too high: {{response_time}}s"
          - expression: error_rate > 1
            message: "Error rate is too high: {{error_rate}}%"
      - match: .* # catch all
        rules:
          - expression: response_time >= 0.5
            message: "Response time is too high: {{response_time}}s"
          - expression: error_rate > 1
            message: "Error rate is too high: {{error_rate}}%"
      - empty: "expected at least one result, got none" # only fires if configured
```

The trigger.**rule** object has the following additional properties that can be set:

- *days* - the days of the week to apply the rule to (example: [mon, tue, wed, thu, fri]) - defaults to every day
- *time* - the time of day to apply the rule to (example: 00:00-06:00) - defaults to all hours of the day

Example period formats

- `-10m to -5m` is 10 minutes ago to 5 minutes ago
- `-1h to 0h` is hour ago to now
- `-1d to -1h` is 24 hours ago to 1 hour ago
- `today` is from 00:00AM until now
- `yesterday` is from 00:00AM yesterday until 00:00AM today

**Metric Evaluator**

The metrics evaluator enables you to define rules across the high level metrics results:

- avg
- sum
- min
- max
- count
- latest

For each aggregated metric result, it exposes these values and any other columns (_collector, _source, etc) in the result set.

```yaml
sumo:
  cpu-performance:
    mode: metrics
    token: sumo-token # the tool will expect an environment variable with the appropriate token using this key
    period: -5m to -0m
    query: >
      metric=cpu_total _source=*yoursource*
      | quantize to 1s
      | avg by _sourcehost # any metric can be chosen here and it will return min, max avg, count in the period
    identifier: _sourcehost
    emit: [avg] # only emit the average cpu in the output
    triggers:
      - match: .* # catch all
        rules:
          - expression: avg >= 50
            message: "CPU is too high: {{avg}}%"
      - empty: "expected at least one result, got none" # only fires if configured
```

**Tokens**

Tokens for Sumo Logic are referred to by name. The tool will expect an environment variable with the relevant token name.
To avoid rate limits, Barky has built in sequencing to manage concurrent requests to Sumo Logic. In addition, its possible
to configure a number of different tokens and have these rotated in a round-robin fashion. To do this simply define
additional tokens with the convention `token-1`, `token-2` etc. For example, for a given token called `my-sumo-token`,
you could define an additional token called `my-sumo-token-1`, `my-sumo-token-2` etc. Note that the suffix format `_1`, `_2` etc
is also supported.

##### MySQL Configuration

The example below will execute the given mysql query, and iterate over the result set.

The `triggers` define the set of rules that will trigger alerts. The first trigger that matches the value for the identifier and relevant rules will be selected and evaluated.
The trigger's rule expression is evaluated as JavaScript.

The example below does not have any alerts configured, see web example above to see what you can do with alerts.

Note, the `connection` value is used to lookup environment variables by convention (`mysql-{connection name}-host|password...`). 
For connection name, set the `connection` key in the YAML config. 

Example using the connection name `aws-aurora`.

- mysql-aws-aurora-host=10.0...
- mysql-aws-aurora-user=your_user
- mysql-aws-aurora-password=your_password
- mysql-aws-aurora-port=3306
- mysql-aws-aurora-database=your_schema
- mysql-aws-aurora-ssl-disabled=true
- mysql-aws-aurora-allow-public-key-retrieval=true (optional, for MySQL 8+ `caching_sha2_password` over non-TLS - dynamically fetches the public key)
- mysql-aws-aurora-public-key=<base64-encoded PEM> (optional, base64 of the server's public key PEM — avoids the key-retrieval round-trip)


```yaml
mysql:
  queue-processing:
    name: queue-performance
    quiet: true # successful evaluation is suppressed
    connection: aws-aurora
    timeout: 15000 # query will timeout after 15s
    query: >
      set transaction isolation level read uncommitted;
      select queue, unprocessed, minutes_to_process from some_view;
    # identifier: string | string [] - plucks the values from each result entry as the identifier (should be unique),
    # if an array is specified, the values are plucked and concatenated with a : separator
    # if the identifier is not configured, the identifier defaults to the name of the monitor, and if multiple rows 
    # are returned, each result is emitted with a unique incrementing suffix (starting from 1)
    identifier: queue
    # fill - an optional array of entries to fill in the result set to evaluate (if missing from the query); if the
    # identifier is an array, the identifier values in the fill need to be an array as well, in the same order,
    # for example: 
    #  identifier: [queue, server]
    #  fill:
    #    - identifier [important-queue, 10.0.0.1]
    fill:
      - identifier: queue
        minutes_to_process: 100
    emit: [unprocessed, minutes_to_process] # optional, if not set, all fields are emitted in log
    triggers:
      - match: .* # catch all
        rules:
          - expression: minutes_to_process >= 10
            message: "Queue is backlogged with {{ unprocessed }} msgs & will take {{ minutes_to_process }} minutes to catch up"
      - empty: "expected at least one result, got none" # only fires if configured
    alert:
      # see web evaluator for example alert configuration
```

The trigger.**rule** object has the following additional properties that can be set:

- *days* - the days of the week to apply the rule to (example: [mon, tue, wed, thu, fri]) - defaults to every day
- *time* - the time of day to apply the rule to (example: 00:00-06:00) - defaults to all hours of the day

##### Shell Configuration

The example below demonstrates how to run a custom shell script.

```yaml
shell:
  my-script:
    timeout: 5s # defaults to 10 seconds
    name: my-script
    path: ./my-script.sh # relative to current yaml file (or absolute path)
    responseType: json
    # identifier: string | string [] - plucks the values from each result entry as the identifier (should be unique),
    # if an array is specified, the values are plucked and concatenated with a : separator
    # if the identifier is not configured, the identifier defaults to the name of the monitor, and if multiple rows 
    # are returned, each result is emitted with a unique incrementing suffix (starting from 1)
    identifier: id
    # fill - an optional array of entries to fill in the result set to evaluate (if missing from the query); if the
    # identifier is an array, the identifier values in the fill need to be an array as well, in the same order,
    # for example: 
    #  identifier: [id, ip]
    #  fill:
    #    - identifier [123, 10.0.0.1]
    fill:
      - identifier: 123
        failed_requests: 0
    triggers:
      - match: .*
        rules:
        - expression: "exitCode !== 0"
          message: "Script failed with exit code {{exitCode}}"
        - expression: failed_requests > 0
          message: "Failed requests was {{ failed_requests }}"
      - empty: "expected at least one result, got none" # only fires if configured
    alert:
      # see web evaluator for example alert configuration
```

Supported response types:

- `json` - Barky expects a json string response (the raw response will be emitted into a `stdout` variable), note that if the result is a JSON array or JSONL, multiple results will be returned
- `string` - Barky expects a string response and will emit this into a `stdout` variable

All environment variables are injected into the script for use. All non-alphanumeric and underscore characters are replaced with `_` in the variable name. Example `my-var` becomes `my_var` and can be accessed with `$my_var`.

A more complex example:

```yaml
shell:
  validate-country-$1:
    vary-by: [za,us,gb]
    path: ./my-script.sh # each fanned out vary-by result will have the variation passed as an argument, i.e. ./my-script.sh za
    responseType: json
    identifier: id
    triggers:
      - match: .* # catch all (you can match on the identifier field in the result set, and if missing or not set, the vary-by value will be used here 
        rules:
          - expression: "exitCode !== 0"
            message: "Script failed with exit code {{exitCode}}"
          - expression: my_field > 0
            message: "Failed requests was {{ failed_requests }}"
      - empty: "expected at least one result, got none" # only fires if configured
    alert:
      # see web evaluator for example alert configuration
```

### Advanced

When defining expressions or messages, you can access all fields on each result set using the `{{ field_name }}` syntax.
In addition, you can access configuration for the current app/scope using `_context`, e.g. `{{ _context.name }}` returns the current app name.

---
## Digest

The digest is the second phase of the tool, and is optional. This controls the execution of alerts.

The digest execution requires configuration of channels and their output. The digest is run as part of the monitor execution, so will only have access to the monitors configured.

Supported channels:

- Console (emits to stdout for debugging - no configuration required)
- SMS
- Slack

When executed, the digester evaluates and compares last monitor snapshot to the current snapshot and makes decisions as to what to do based on configuration.

In addition to defining the channel configuration, the digest may also optionally configure alert policies that can be used in the alert configuration.
You may want to define shared configuration for aspects such as exception policies, for when a monitor cannot evaluate due to an unhandled error.

Example configuration:

```yaml
mute-windows: # alerts are silenced if generated in these window periods
  - match: mysql.*performance # only for monitors matching this regex
    time: 00:00 - 06:00
  - date: 2023-08-27  # only matches for this specific date
    time: 22:00 - 24:00 # 2PM to 4PM for a specific date
  - time: 00:00 - 06:00 # every weekday midnight to 6AM
    days: [mon, tue, wed, thu, fri]

alert-policies:
  monitor-exception:
    channels: [slack]
    rules:
      - description: More than 3 monitor errors in a 10 minute window
        any: 3
        window: -10m

channels:
  sms:
    type: sms
    provider: clickatell_legacy # currently only supported provider
    template:
      prefix: '{{ title }}' # this is a global variable passed in via the CLI "title" param
      postfix: Please see Ops Slack channel for any updates.
    interval: 5m # how often to send alert updates
    contacts: # list of people to contact
      - name: Rohland
        mobile: +2782...
  slack:
    type: slack
    template:
      prefix: '<!channel> {{ title }}' # <!channel> alerts everyone in the given channel
      postfix:
      summary: "<https://acme.com/dashboard|Please see dashboard here:>"
    interval: 1h # how often to post updates as a new message
    token: slack-token # we expect an environment variable with this name
    channel: "#ops"
    workspace: "acme" # this is your workspace name in slack (optional)
```

A note on templates: Slack prevents message updates from exceeding 4k characters, so if the Slack notification exceeds this, a
summary message is posted instead with high level stats of what's going on. In this context, the summary template is included.

**Mute Windows**

Any number of windows can be defined where alerts will be silenced. This is useful for maintenence windows, or when you know that a monitor will be failing for a period of time.

Fields:

- `match`: regex to match monitor identifier(see below for format) (not required)
- `date`: specific date to match (not required)
- `time`: time range to match (required)

The `match` regular expression is used to match against the monitor identifier that is a string value composed of:

- `type` - the type of monitor (example: web, sumo, mysql)
- `label` - the name of the monitor (example: web-performance)
- `identifier` - the name of the failing identifier (example: www.codeo.co.za)

The value is composed as follows: `type::label::identifier`. For example: `web::web-performance::www.codeo.co.za`. The regular expression for match
will thus be compared against this string value (case-insensitive).

### SMS

For SMS, any initial change into a failure state for the relevant team, will trigger a single SMS, which will include a summary of what has gone wrong, and will indicate that further updates will be sent via Slack. An update is posted every 15 minutes.

Example outage alerts (prefix and postfix can be configured):

> {prefix} Outage STARTED at 17:40:00.
> 1 health check affected.
> {postfix}

Example update configured at interval:

> {prefix} Outage ONGOING for 15 minutes (since 17:40:00).
> 1 health check affected.
> {postfix}

Example resolution notification:

> {prefix} Outage RESOLVED at 17:59:00. Duration was 19 minutes. 
> {postfix}

Currently, the only supported provider is the Clickatell legacy SMS gateway at https://sms-gateway.clickatell.com/.
The provider expects the following environment variables to be configured:

- clickatell-key=your_key
- clickatell-user=your_user
- clickatell-password=your_password

### Slack

For Slack, more detail is posted about an outage, and everyone is notified upon the initial outage via `@everyone`. Example:

> @channel Outage 🔥:
> Started at: 11:15AM
> Duration: 5 minutes
>
> There is an outage affecting 2 health checks:
>
> * web:health check → www.codeo.co.za (expected 200, received 500)
> * web:health check → www.codeo2.co.za (expected 200, received 500)
> 
> Last updated: 11:20AM

The above message will be updated at the interval the tool is updated, and at the `notification_interval` a new message will be started (to assist with the notification scrolling offscreen in Slack).

Example resolution:

> ✅ @channel Previous outage resolved at 10:11:08. Duration was 1 minute.
> See above for more details about affected services.

### Web Interface

A simple web interface is exposed on the configured port (defaults to 3000, editable using the global config) that presents a combined output
of all alerts and their current status. It enables dynamic muting/un-muting of alerts, and provides a summary of
active, resolved and muted alerts. The UI is updated every 10 seconds.

Clicking an alert's rule name shows how that check is declared, in a dialog: the block of yaml it
was read out of, the file and line numbers it came from, and a link to it on GitHub where the rules
are in a git checkout with a GitHub remote. This is the same answer `define` gives in Slack, read
from the same source and with the same values held back - see
[Chat Ops](#chat-ops-slack) for what is redacted and why. It is also available as JSON at
`/api/definition?id=<alert id>`.

Security of this interface is left in the hands of the user.

### Chat Ops (Slack)

Barky can take instructions in Slack, so an alert can be muted by replying to the message that
reported it rather than by switching to the dashboard.

```yaml
channels:
  slack:
    type: slack
    token: slack-token             # bot token (xoxb-...), used to post
    channel: "#ops"
    chat-ops:
      enabled: true
      app-token: slack-app-token   # app level token (xapp-...), used to listen - see below
      dashboard-url: https://barky.acme.com  # linked whenever barky suggests the dashboard
      selection-ttl: 10m           # optional - how long a numbered list stays valid
      max-mute: 7d                 # optional - longest mute anyone can ask for
      mention-name: barky          # optional - what people call barky when they @ it
      ai:                          # optional - understands plain english when configured
        api-key: openai-api-key    # env var holding an OpenAI key
        model: gpt-5.6-luna        # optional - discovered automatically when omitted
        url: https://api.openai.com/v1   # optional - point at azure, a gateway or a local model
        timeout: 15s               # optional
        max-calls-per-hour: 60     # optional
```

Every value except `enabled`, `app-token` and the AI `api-key` is optional.

**The two tokens**

These are two different Slack credentials and both are needed - they are not a duplication:

- `token` is the **bot token** (`xoxb-...`), which barky already uses to post alerts. It is what
  barky talks to Slack *with*.
- `app-token` is an **app level token** (`xapp-...`), which authorises the Socket Mode websocket.
  It is what barky *listens* on. It is scoped to the app rather than to a workspace installation,
  and cannot post anything by itself.

Barky checks its granted scopes when it starts and logs which are missing (visible with `--debug`),
since an app that cannot read mentions looks exactly like one that is ignoring you.

Chat ops connects over [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode),
so barky needs no inbound network access and no public URL. It only runs under the `loop` command,
since the connection has to outlive a single evaluation. If Slack cannot be reached, barky logs it
and carries on monitoring, retrying every five minutes.

**One slack app per barky**

Every barky that runs chat ops needs a Slack app of its own. Slack hands each event to *one* of the
sockets an app has open rather than repeating it to all of them, so two barkys sharing an `app-token`
split the replies between them at random - and the one that receives a reply to a thread it did not
post cannot act on it: the alerts it names, and the mutes that would silence them, live in the
database of the barky that posted it. The reply is dropped, and nothing is said in the channel.

This is not something barky can work around. Slack offers no way to say which connection an event
belongs to, and the instances share nothing but the workspace.

The symptom is distinctive: barky answers some replies and ignores others at random, while alerting
carries on working perfectly - posting alerts is an ordinary API call and never touches the socket.
Run with `--debug` and barky reports how many connections its app has open, which is the first thing
to check:

> chatops: this slack app has 4 socket connections open, so this is not the only barky listening on it

One is what you want. See *Setting up a slack app for an instance* below.

**Several barkys in one channel**

Separate barkys, each with a slack app of its own, can sit in the same channel - that is the setup
the section above asks for, and there is nothing to configure for it. Slack only tells an app about
mentions of *its own* bot user, though, so `@barky-yumbi 1` is never delivered to `barky-spar` as a
mention at all, and people naming the wrong one in a thread is inevitable once there are two.

So barky reads the ordinary channel messages it already receives, and answers a reply that names
*any* barky as long as it is in a thread it posted itself. The thread is what decides: the barky
that posted an alert is the only one that knows what the numbers in a reply mean, and the others
have no record of the thread and stay out of it, whichever of them was named. Exactly one answers,
as before.

Naming is what matters, not the subject: `@barky 1` is an answer, and "wonder if barky is broken"
is people talking to each other, which barky stays out of. Recognising a mention of *another* barky
means turning the id slack puts in the message back into a name, and that lookup needs the
`users:read` scope - without it barky still answers mentions of itself as it always did.

Set `mention-name` where your barkys are not called barky - it is matched against the bot's slack
display name, without case and anywhere in it, so `barky` covers `Barky`, `barky-spar` and
`Barky (YUMBI)`.

**More than one channel**

Chat ops is configured once per Slack app, not once per channel. Every other slack channel posting
with the same bot `token` is covered by it, because that is the same app: it already receives those
events and can already post there. So alerts routed to `#ops` and `#db` are both answerable with
one `chat-ops` block:

```yaml
channels:
  slack-ops:
    type: slack
    token: slack-token
    channel: "#ops"
    chat-ops:
      enabled: true
      app-token: slack-app-token
  slack-db:
    type: slack
    token: slack-token          # same bot, so chat ops covers this channel too
    channel: "#db"
  slack-quiet:
    type: slack
    token: slack-token
    channel: "#noise"
    chat-ops:
      enabled: false            # opt this one out
```

Opting a channel out takes effect on the next pass: barky stops answering there, including in the
threads of alerts it had already posted in that channel.

A channel posting with a *different* bot token is a different Slack app, and needs its own
`chat-ops` block with its own `app-token`. Barky then opens a connection per app and keeps them
apart: each reply is answered by the channel config that posted the alert it is threaded under, so
it goes out with a token that can actually post there.

At startup barky logs the channels each app covers, and says so when a `chat-ops` block cannot be
used - one that cannot listen otherwise looks exactly like one that is working. Both are visible
with `--debug`.

Two settings are needed to receive anything, on two different screens, and **both are required**:

- **OAuth & Permissions** grants the app *permission* to read mentions and channel history
- **Event Subscriptions** tells Slack to actually *send* those events

Granting the scope does not subscribe you to the event. With scopes but no subscriptions, barky
connects to Slack successfully, posts alerts, and silently never receives a single reply - there is
no error anywhere, because nothing is wrong from Slack's point of view.

**Setting up a slack app for an instance**

Since every barky needs its own app, name each one for the instance it belongs to. The bot's
*username* has to be unique in the workspace; its *display name* does not, so all of them can still
appear as plain `Barky` in the channel:

| Setting | Where | Example |
|---|---|---|
| App name | *Basic Information* → *Display Information* | `Barky (SPAR)` |
| Icon | *Basic Information* → *Display Information* | the same image for all of them |
| Display name | *App Home* → *Your App's Presence in Slack* | `Barky` |
| Default username | *App Home* → *Your App's Presence in Slack* | `barky-spar` |

Slack appends a number to a username that is already taken, so set it explicitly rather than letting
it pick. Each bot is only invited to its own channel, so typing `@bark` there offers the one that
belongs to it - Slack ranks channel members first - and picking the wrong one fails loudly with
"they're not in the channel" rather than silently.

1. Create the app at api.slack.com/apps and fill in the names above.
2. Under *Socket Mode*, turn it on. This generates an app level token (`xapp-...`) with the
   `connections:write` scope - that is `app-token`.
3. Under *OAuth & Permissions* → *Scopes* → *Bot Token Scopes*, add the scopes in the table below.
4. Under *Event Subscriptions*, toggle *Enable Events* on, then expand *Subscribe to bot events*
   and add both `app_mention` and `message.channels` (`message.groups` for a private channel).
   Socket Mode means there is no request URL to verify - the section may look finished without
   these, so check the list itself rather than the toggle.
5. Install the app to the workspace and copy the bot token (`xoxb-...`).
6. Invite the bot to the channel barky posts to: `/invite @barky-spar`.

**Wiring it up**

Name the environment variables for the instance too, so it is obvious which app a config belongs to:

```
slack-token-spar=xoxb-...       # bot token, posts alerts and replies
slack-app-token-spar=xapp-...   # app level token, holds the socket open
```

The digest config names those variables rather than the tokens themselves:

```yaml
channels:
  slack-ops:
    type: slack
    token: slack-token-spar            # this instance's bot token
    channel: "#spar-ops"
    chat-ops:
      enabled: true
      app-token: slack-app-token-spar  # this instance's app level token
```

Both must belong to the *same* app: the bot token posts the alert, and the app token listens for the
replies to it. Mixing tokens from two apps means barky posts as one bot while listening as another,
and every reply goes unanswered.

To check it: start barky with `--debug` and look for

> chat ops is listening for slack-ops (#spar-ops)

and make sure the line about *socket connections open* does not appear. If it does, another barky is
running on the same app - see *One slack app per barky* above.

**Bot token scopes**

| Scope | Required | What it is for | Without it |
|---|---|---|---|
| `chat:write` | yes | Posting alerts and replies | Nothing works |
| `app_mentions:read` | yes | Being told when someone mentions barky | Barky never receives anything |
| `channels:history` | yes | Reading the thread a mention arrived in (`groups:history` for a private channel) | Barky never receives anything |
| `users:read` | no | Looking up the display name of whoever ran a command, and of the barky a reply names | The chat ops log records the Slack user id (`U0HKZGDKQ`) instead of a name, and a reply naming *another* barky in a shared channel is not recognised as naming one |
| `reactions:write` | no | The 👀 acknowledgement while barky is thinking | No reaction, everything else unaffected |

Barky reports any that are missing when it starts, visible with `--debug`.

**Naming people in the chat ops log**

Slack only ever tells barky the *id* of whoever sent a message - `U0HKZGDKQ`, never a name. Turning
that into something readable needs a lookup, and that lookup needs the `users:read` scope. There is
no way around it: the display name is not in the message payload.

So if the chat ops log shows ids rather than names, add `users:read` under *OAuth & Permissions*
and reinstall the app. Two things to expect afterwards:

- **Entries already recorded keep their ids.** The name is captured at the time of the action, so
  only new entries pick it up.
- Where a name cannot be resolved the id is shown with a dotted underline, and hovering it explains
  why - so an id in the log always means the scope is absent, never that something failed silently.

**Adding chat ops to the app you already use for alerts**

If barky is already posting alerts, that app only needs a token to post with - it has no way to
listen. To add chat ops to it:

1. Open the existing app at api.slack.com/apps and turn on *Socket Mode*, generating an app level
   token (`connections:write`). Put it in `app-token`.
2. Under *OAuth & Permissions*, add the scopes from the table above to the ones it already has -
   an app built only to post alerts typically has just `chat:write` and `incoming-webhook`. An app created
   only to post alerts typically has just `chat:write` and `incoming-webhook`, and **without the
   read scopes Slack never delivers any events at all** - barky connects, posts alerts and appears
   to ignore every reply. **Adding scopes requires reinstalling the app** - Slack will prompt you,
   and the existing `xoxb-` token keeps working afterwards, so `token` does not change.
3. Under *Event Subscriptions*, toggle *Enable Events* on, then under *Subscribe to bot events*
   add `app_mention` and `message.channels` (`message.groups` for a private channel). An app that
   only posted alerts has no subscriptions at all, and this is a **separate step from the scopes
   above** - adding `app_mentions:read` in step 2 does not subscribe you to `app_mention`.
   **Changing subscriptions also requires reinstalling**, the same as scopes.
4. Make sure the bot is a member of the channel - it may already be, if it posts there.

No change to your alert configuration is needed; chat ops sits alongside it.

**If barky posts alerts but ignores every reply**

The app is connected but is not being sent anything. In order of likelihood:

1. *Event Subscriptions* has no `app_mention` under *Subscribe to bot events* - the most common
   cause, because the scopes screen looks complete on its own.
2. Scopes or subscriptions were changed without reinstalling the app afterwards.
3. The bot is not a member of the channel.
4. The reply did not name barky, or was not in the thread of one of barky's own alert messages
   - barky deliberately ignores everything else, including top level mentions in the channel. A
   reply naming another barky in the same channel *is* answered, but only in a thread this barky
   posted, and only with `users:read` granted - see *Several barkys in one channel* above.
5. The channel posts with a different bot token to the one chat ops is configured on, so no app is
   listening there - see *More than one channel* above.

**If the chat ops log shows Slack ids instead of names**

The `users:read` scope is not granted - see *Naming people in the chat ops log* above.

Run with `--debug` and barky reports which scopes are missing at startup. The quickest check of the
rest is your app's *App Manifest*, which should contain:

```yaml
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
  socket_mode_enabled: true
```

Anyone who can see the channel can mute - channel membership is the authorisation boundary, so
there is no separate user list to maintain.

**Talking to barky**

Barky only takes part in the threads of its own alert messages, and only when it is addressed
directly. It does not watch the rest of the channel, it does not answer direct messages, and it
stays out of conversations between people - including conversations in an alert's own thread.
Mention it in an alert thread, and it replies in that same thread:

> **barky**: 🔥 Ongoing Outage!
> `web::health::www.acme.com` — expected 200, received 500
> `mysql::lag::db-01` — 340 seconds behind
> > **@rohland**: @barky mute
> >
> > **barky**: *2 active alerts* — reply with numbers (`1,3`), `all`, or `cancel`.
> > Add a period to override the default of *08:00 tomorrow* — for example `1,3 for 4h`.
> >
> > `1.` web::health::www.acme.com — _expected 200, received 500_
> > `2.` mysql::lag::db-01 — _340 seconds behind_
> >
> > **@rohland**: 1 for 4h
> >
> > **barky**: 🔕 Muted until *12:30 today*: web::health::www.acme.com

**Every message to barky must mention it, including answers to its own questions.** That is
deliberate: people working an outage need to be able to say "all" or "1" to each other in the
thread without barky acting on it.

While an alert is ongoing barky also posts a short follow-up ping to the channel, so a long running
outage does not scroll away. That message is deleted and reposted every time barky checks, so
anything said in its thread goes with it. Mention barky there and it answers with a link back to
the alert's own thread rather than acting:

> **barky**: 🔥 @channel Alert ongoing: `3 problems` for `27h, 44m and 56s`. See above ☝️
> _reply in the thread above to mute_
> > **@rohland**: @barky mute for 1hr
> >
> > **barky**: 👆 I repost this message every time I check, so anything either of us says here goes
> > with it. Mention me in the alert's own thread instead and I'll pick it up.

The link needs `workspace` set on the channel; without it barky names the thread without linking to
it.

The list is pinned at the moment it is posted, so `all` always means the alerts you were shown -
anything that starts alerting in between is reported back to you rather than quietly swept into the
mute. That is measured against the set the list was drawn from, so a list drawn inside an alert's
thread is compared to what that message reported rather than to the whole system. An alert that recovers while you are typing is still muted, so it stays quiet if it flaps
back.

**Replying to an alert directly**

Barky remembers which alerts each of its messages was reporting, so the thread already says what
you mean:

> **barky**: 🔥 Ongoing Outage! ... web::health::www.acme.com ...
> > **@rohland**: @barky mute
> >
> > **barky**: 🔕 Muted until *08:00 tomorrow*: web::health::www.acme.com

Where the message covered several alerts, `mute` offers just those to choose from and `mute this`
takes all of them - in both cases unrelated alerts elsewhere are left alone. If everything that
message reported has since cleared, barky says so rather than muting nothing.

Note that `mute this` only means "everything here" inside a thread. Said anywhere else it has no
referent, so barky shows the list instead.

**Asking how a check is configured**

`define` answers with the yaml that declares a check, read back out of the rules file it lives in -
comments and all, rather than rebuilt from what barky loaded:

> **barky**: 🔥 Ongoing Outage!
> `web::health::www.acme.com` — expected 200, received 500
> `mysql::lag::db-01` — 340 seconds behind
> > **@rohland**: @barky define
> >
> > **barky**: *2 active alerts* — mention me with the number you want the configuration for (`2`), or `cancel`.
> >
> > `1.` web::health::www.acme.com — _expected 200, received 500_
> > `2.` mysql::lag::db-01 — _340 seconds behind_
> >
> > **@rohland**: 2
> >
> > **barky**: 📄 `mysql::lag::db-01` — defined in `configs/acme.yaml`
> > ```
> > lag:
> >   connection: db-01
> >   query: show slave status
> >   identifier: status
> > ```

`config`, `configuration` and `explain` are read the same way. Asked inside an alert's own thread,
or when only one alert is active, barky skips the list and answers directly.

One definition per reply: a block of yaml is most of a Slack message on its own, so `1,3` and `all`
are declined rather than half answered, and the list stays up for whichever one you meant.

A check using `vary-by` is declared once and alerts under each variation, so barky shows the block
and says which variation the alert in front of you is. An id like `mysql::monitor::replication`
reports the check failing to run at all, and answers with what that check declares.

Values under keys that could hold a secret - `password`, `token`, `authorization`, `*-key` and the
like - are posted only where they read as the name of an environment variable, which is barky's own
convention: the `$` form (`Authorization: $my-auth-token`), or a short separated name written in one
case (`token: sumo-token`). Anything else in that position is replaced with `***redacted***` and the
message says how many values were held back.

A block too long for one Slack message is cut at a line boundary. Where the rules file is in a git
checkout with a GitHub remote, the rest of it is a link: barky links the commit it is running
rather than a branch, so the lines keep pointing at what it actually read. There is no link where
git is not on the path, the file is not tracked, the remote is not GitHub, or the commit is on no
remote branch yet - in each of those a link would go nowhere, so barky names the file and the line
number instead.

Commands:

- `mute` / `unmute` - lists what is available and waits for your numbers
- `mute all` / `unmute all` - acts on everything, and works even when the list is too long to show
- `define` / `config` - lists the active alerts and waits for one number, then shows how that check is configured
- `status` - what is currently alerting and what is muted
- `help`
- `cancel` - abandons a pending list

Replies to a list accept `1`, `1,3`, `2 and 4`, `1-3` or `all`, optionally with an expiry. Ordinary
politeness is read straight through, so `all please` and `1,3 thanks` are the answers they look like.

Where a list would be too long to fit in a single Slack message, barky points at the dashboard
instead of posting an unusable wall of numbers. `mute all` needs no list, so it still works.

**Audit trail**

Every mute, unmute and define made through Slack is recorded - who asked, what they said, which
alerts were affected and until when - and kept for 30 days. People are named by their Slack display name where
the optional `users:read` scope is granted, and by their Slack id otherwise. It survives Slack message retention and deletion.

The dashboard has a **Chat ops log** link in the top right that shows it, and it is also available
as JSON at `/api/chat-ops/audit`.

**Mute duration**

With no period given, a mute runs until the next business day - the next occurrence of 08:00 on a
weekday. This is deliberately not configurable. Note it resolves to the next such moment still
ahead of you, so muting at 02:00 on a Tuesday lasts until 08:00 that morning rather than until
Wednesday, and muting on Friday afternoon lasts until Monday.

An expiry can be given either as a period or as a day, on the original request or on the reply to
a list - `mute for 4h`, `mute until Monday`, `1,3 for 90 mins`, `all until tomorrow`. Periods accept
`s`, `m`/`mins`/`minutes`, `h`/`hours` and `d`/`days`. Days accept `tomorrow` or any weekday, long
or short (`until thurs`), and resolve to 08:00 on the next such day still ahead - so `until
Thursday` said on a Thursday afternoon means the following one.

Saying it once is enough: an expiry given with the original request survives the detour through a
numbered list, and an expiry named on the reply overrides it.

Anything longer than `max-mute` is capped. Barky's own default is exempt, since on a Friday it
legitimately reaches into Monday.

**Plain english**

The commands above work on their own. Configure `ai` as well and barky will interpret anything it
does not recognise, so "silence the database one for an hour" works as well as `mute` followed by
a number, and "what does the db one actually check?" works as well as `define`.

It is only ever asked to pick numbers from a list barky supplies. It never names an alert,
builds a mute expression or works out an expiry time - barky does all of that, and discards any
number that was not on the list it gave. Output captured from monitored systems is passed to the
model inside a delimited block and marked as data, and any delimiter the output itself contains is
stripped along with its line breaks - so a failing check can neither smuggle in an instruction by
putting one in its response body nor close the block early to make it look like barky's own words. Where the model is unsure, it is told to show the
numbered list rather than guess.

**Choosing a model**

Leave `model` unset and barky lists the models your key has access to when it starts, then picks the
newest cost optimised one - the job is choosing a number from a short list, so the cheapest capable
model is the right one. Models announced for shutdown are skipped, as are pinned snapshots in favour
of their moving alias, so the choice keeps up with the lineup on its own rather than being pinned to
a name that ages out. The model it settled on is written to the log at startup.

Set `model` explicitly to override that. If the lookup fails, barky reports the AI service as
unavailable and retries on the next request rather than guessing a name.

Any request barky cannot interpret locally costs one API call, capped at `max-calls-per-hour` -
a ceiling across every channel configured with the same AI settings, rather than one each.
Replies that are plainly numbers (`1,3`, `all`) never reach the model at all.

If the AI service times out or is unreachable, barky says so and points at the dashboard rather
than guessing:

> ⚠️ I can't reach the AI service right now, so I can't interpret that.
> Please use the alerts dashboard, or reply with plain numbers (`1,3`) or `all` if I've given you a list.

Numbered replies keep working throughout an outage of the AI service, since they never needed it.

### Message Templates

Messages using `{{ some_var }}` syntax have access to a few helper functions:

- **humanizeNum(value, decimalPlaces)** - formats a numeric value into a human readable format (example: 1000 becomes 1k)
- **humanizeDuration(value, unit = "m")** - formats a duration (defaults to minutes) into a human-readable format (example: 64 becomes 1h and 4m), use "s" for seconds and "h" for hours

## Integration Testing

Configure a local `.env.local` file with the configuration as outlined in the documentation above, and then execute
as follows. Note, Barky will prioritise `.env.local` over entries in a `.env` file.

```bash
# this expects that you have a subfolder called path and files called config.yml and digest.yml
pnpm start:loop ./path/config --eval=web --digest=./path/digest --debug
```
