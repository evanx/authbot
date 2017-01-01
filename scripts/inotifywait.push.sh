
  while true
  do 
    inotifywait index.js -qe close_write
    cat index.js | redis-cli -x -p 6333 lpush 'authbot:index.js'
  done
