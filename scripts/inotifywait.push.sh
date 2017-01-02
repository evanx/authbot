
  ns='restart:authbot'
  file='index.js'
  while true
  do 
    inotifywait $file -qe close_write
    cat $file | redis-cli -x -p 6333 set $ns:$file
    redis-cli -p 6333 lpush $ns:req $file
  done

