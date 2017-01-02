set -u -e
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
