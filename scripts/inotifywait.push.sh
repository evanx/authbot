
  ns='restart:authbot'
  while true
  do 
    inotifywait index.js -qe close_write
    cat index.js | redis-cli -x -p 6333 set $ns:index.js
    redis-cli -p 6333 lpush $ns:req index.js
  done

