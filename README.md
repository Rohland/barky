# Barky - Cloud Watchdog
_Warning: Currently in alpha, use at own risk_

![Barky](./assets/barky.png)

Barky is intended to run custom monitoring in a simple and effective way, using a tool with no external dependencies (like databases) in order to drive effective alert/outage notifications.

**What problem does this solve?**

The noise and complexity of standard alerting solutions. When things go south, you don't want to be bombarded with hundreds of notifications. Barky's digest feature allows you to configure alerts in a way that you can be notified of an outage, and then be notified when the outage is resolved. It also allows you to configure alerts to only trigger during specific times of the day, and only on specific days of the week.

**What does this do?**

It runs a custom set of evaluators (configured in simple markup using YAML) with (current) support for the following checks:

- **web**: Evaluate any accessible site and validate status code, response time and response body
- **sumo**: Runs custom Sumo Logic queries and evaluates results based on validator configuration
- **mysql**: Runs custom mysql queries and evaluates results based on validator configuration

Evaluations supported:

- Consecutive failures - trigger after a given number of consecutive failures
- Failures in window period - trigger after a given number of failures in a sliding window period

The results of the evaluators are emitted via `stdout` using a pipe delimited format (per monitor). This can be logged and ingested into any cloud log management tool for tracking.

In addition to this, the results are evaluated and alerts emitted in a digest format via the following supported channels:

- SMS
- Slack

So, the pipeline is `Evaluate > Digest` where the evaluation emits status of things monitored and the digest step emits any alerts (triggered, ongoing or resolution) via the configured channels. The digest step is optional.

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
```

The following high level keys are supported (note, it is case sensitive):

- web
- sumo
- mysql

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
- `vary-by` - Array<string|string[]> - enables variations of fields like name, url or query (depending on the type of evaluator)
- `every` - String value representing how often to evaluate the rule, defaults to "30s" - value must be multiples of 30s, examples: 60s, 90s, 10m, 1h (only applicable in loop mode)

** Variation **

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

You can get further information about any error by running the tool using the `--debug` switch.


Additional values that can be configured:

- `method` defaults to `get`
- `status` defaults to 200
- `max-redirects` defaults to 5 - set to 0 to disable redirects
- `timeout` defaults to 5000 (5 seconds)
- `headers` - a custom set of headers (see example below) - these can include environment variables using $ prefix
- `vary-by` - enables variations of a given url, an instance for each variation is monitored
- `validators` - enables a set of custom validators that must all be successful
- `alert` - defines the alert rules, see below

**Alerts**

Fields:

* `channels` - an array of channels to use (example: `[sms, slack]`)
* `links` - optional array of links to include when alerts trigger
* `rules` - an array of rules
	* `description` - not required
	* `count|any` - count means trigger after defined consecutive count of errors, any means trigger after `any` count of errors in the window period defined
	* `window` - not required, but useful to constrain `any` operator to the given window, example: `-30m` means last 30 minutes. Maximum window is `24h`. Defaults to 5 minutes if not specified
	* `days` - array of days and only required if you want to constrain the trigger to specific days of week (see example)
	* `time` - array or single range value, only required if you want to constrain the trigger to specific times of the day (times are in UTC)
* `exception-policy` - the name of the alert policy (defined in the digest configuration) to use for monitor failures (such as timeouts or exceptions), if not set then the same alert configuration rules defined above will be used when the monitor incurs an unhandled error

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
    validators:
      - text: ok
        message: Expected to find text "ok" in response but didn't
    alert: 
        channels: [sms, slack]
        links:
          - label: Playbook
            url: "https://notion.so"
        rules:
            - description: Weekdays
              count: 2 # any consecutive 2 failures trigger alert
              days_of_week: [mon, tue, wed, thu, fri]
              time_of_day: [00:00-04:00, 6:00- 17:00] # local time as per timezone
            - description: Weekends
              window: -5m
              any: 3
              days: [sat, sun]
              time: 04:00 - 17:00 # UTC
```

##### Sumo Logic Configuration

The example below will search Sumo Logic using the given query, and iterate over the result set. The time window
searched is specified by `period`. The validators evaluate each row (the expression is evaluated as JavaScript).

For Sumo Logic queries, the default domain is `api.eu.sumologic.com` - however, this can be overridden using an 
environment variable called `sumo-domain`.

The example below does not have any alerts configured, see web example above to see what you can do with alerts.

```yaml
  web-performance:
    name: web-performance
    quiet: true # successful evaluation is suppressed
    token: sumo-token # the tool will expect an environment variable with the appropriate token using this key
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
    identifier: site # this specifies what field in the result set is the identifier to iterate over
    validators:
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
```

##### MySQL Configuration

The example below will execute the given mysql query, and iterate over the result set. The validators evaluate each row (the expression is evaluated as JavaScript).

The example below does not have any alerts configured, see web example above to see what you can do with alerts.

Note, the `connection` value is used to lookup environment variables by convention (`mysql-{your-key}-host|password...`).

- mysql-aws-aurora-host=10.0...
- mysql-aws-aurora-user=your_user
- mysql-aws-aurora-password=your_password
- mysql-aws-aurora-port=3306
- mysql-aws-aurora-database=your_schema


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
    identifier: queue
    validators:
      - match: .* # catch all
        rules:
          - expression: minutes_to_process >= 10
            message: "Queue is backlogged with {{ unprocessed }} msgs & will take {{ minutes_to_process }} minutes to catch up"
```
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
  - match: mysql:performance # only for monitors matching this regex
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
        window: 10m

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
    interval: 1h # how often to post updates as a new message
    token: slack-token # we expect an environment variable with this name
    channel: "#ops"
```

**Mute Windows**

Any number of windows can be defined where alerts will be silenced. This is useful for maintenence windows, or when you know that a monitor will be failing for a period of time.

Fields:

- `match`: regex to match monitor names (not required)
- `date`: specific date to match (not required)
- `time`: time range to match (required)

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
