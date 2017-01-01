
mkdir -p tmp

pid=''

while true  
do
  redis-cli brpop 'authbot:src' 10 | tail -n +2 > tmp/index.js
  wc tmp/index.js
  head tmp/index.js 
  if head -1 tmp/index.js | grep '^const'
  then
    if [ -n "$pid" ]
    then
      echo "kill $pid"
      kill $pid
      sleep .25
    fi
    loggerLevel=debug configFile=~/private-config/authdemo.webserva.com/authbot.production.js node --harmony-async-await tmp/index.js &
    pid=$!
    echo "pid $pid"
    sleep 1
    ps aux | grep authbot.production | grep debug 
    redis-cli hgetall 'authbot:started'
    rpid=`redis-cli hget 'authbot:started' pid`
    echo "rpid $pid"
  fi
done
