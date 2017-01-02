

  for key in `redis-cli keys 'authbot:*:s'`
  do 
    echo $key
    redis-cli smembers $key
    echo
  done 

  for key in `redis-cli keys 'authbot:*:h'`
  do 
    echo $key
    redis-cli hgetall $key
    echo
  done 
