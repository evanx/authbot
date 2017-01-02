set -u -e
mkdir -p tmp
ns='restart:authbot'
redis-cli del $ns:req
redis-cli del $ns:adv
while true
do
  file=`redis-cli brpop $ns:req 15 | tail -n +2`
  if [ -n "$file" ]
  then
    redis-cli get $ns:$file > tmp/$file
    redis-cli publish $ns:res $file
    redis-cli lpush $ns:res $file
    ls -l tmp/$file
    head tmp/$file
    echo $ns:adv $file 
  fi
done
