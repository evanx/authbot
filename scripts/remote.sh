

mkdir -p tmp 

while true  
do
  redis-cli brpop 'authbot:index.js' > tmp/index.js
  if head -1 tmp/index.js | grep -q '^const'
  then
    loggerLevel=debug configFile=~/private-config/authdemo.webserva.com/authbot.production.js node --harmony-async-await tmp/index.js &
    sleep 1
    ps aux | grep authbot.production | grep debug 
  fi
done

