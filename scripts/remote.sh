
mkdir -p tmp

ns=restart:authbot
redis-cli del $ns:req
redis-cli del $ns:adv
while [ 1 ]
do
  file=`redis-cli brpop $ns:req 15 | tail -n +2`
  if [ -n "$file" ]
  then
    redis-cli get $ns:$file > tmp/$file
    redis-cli lpush $ns:adv $file
    echo $ns:adv $file
  fi
done

