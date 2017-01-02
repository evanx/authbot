
mkdir -p tmp

redis-cli del authbot:src

srcChannel='authbot:src' srcFile='tmp/index.js' srcQueue='authbot:src' \
loggerLevel=debug configFile=~/private-config/authdemo.webserva.com/authbot.production.js \
node --harmony-async-await index.js &

while true  
do
  srcPort=`redis-cli brpop authbot:src 10`
  if [ -n "$srcPort" ] 
  then
    echo "srcPort $srcPort"
    port=$srcPort endChannel='authbot:end' endQueue='authbot:end' \
    loggerLevel=debug configFile=~/private-config/authdemo.webserva.com/authbot.production.js \
    node --harmony-async-await tmp/index.js &
    endPort=`redis-cli brpop authbot:end 10`
    if [ -n "$endPort" ] 
    then
      echo "endPort $endPort"
      sed -i "s/localhost:[0-9]*; # port/localhost:$endPort; # port" ~/nginx/routes/authdemo
      ssh root@localhost service nginx reload
    fi
  fi
done
