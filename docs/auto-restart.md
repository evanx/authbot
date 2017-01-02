
## Auto restart

In a development environment on the cloud interacting with a test bot, it is useful to watch updated code and restart. For example, we use `inotifywait` on a Linux workstation to watch `index.js`
```shell
ns='restart:authbot'
file='index.js'
while true
do
  inotifywait $file -qe close_write
  cat $file | redis-cli -x -p 6333 set $ns:$file
  redis-cli -p 6333 lpush $ns:req $file
done
```
where we publish the updated `index.js` script via Redis. For example, port `6333` is forwarded by `ssh -L6333:localhost:6379` to a remote cloud box which interacts with the test bot.

Then on the cloud box we run as follows:
```shell
mkdir -p tmp
ns='restart:authbot'
redis-cli del $ns:req
while true
do
  file=`redis-cli brpop $ns:req 15 | tail -n +2`
  if [ -n "$file" ]
  then
    redis-cli get $ns:$file > tmp/$file
    redis-cli publish $ns:adv $file
    echo $ns:adv $file
  fi
done

```
which will write an updated script `tmp/index.js` and publish this event.

The app is configured with an `endChannel`
```javascript
endChannel: 'restart:authbot:adv',
endMessage: 'index.js',
```
The app will subscribe to `endChannel` and exit when an updated `tmp/index.js` is available.
```javascript
async function startSubscribeEnd() {
    state.sub = redis.createClient();
    state.sub.on('message', (channel, message) => {
        if (channel === configFile.endChannel) {
            if (message === configFile.endMessage) {
                end();
            }
        }
    });
    state.sub.subscribe(configFile.endChannel);
}
```
where `end()` will exit with `0` i.e. not an error exit.

We run the app in a loop so that it will auto restart.
```shell
while true
do
  configFile=~/private-config/authtest.webserva.com/authbot/development.js \
  NODE_ENV=development node --harmony-async-await tmp/index.js || sleep 10
done
```
where an error exit will result in a short sleep.

Note that the service is down for a few seconds. As such, this feature is not suitable for production usage.
