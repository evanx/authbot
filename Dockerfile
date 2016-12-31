FROM mhart/alpine-node
ADD package.json .
RUN npm install
ADD src .
ENV port 80
EXPOSE 80
CMD ["node", "--harmony-async-await", "src/index.js"]
