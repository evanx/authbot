FROM mhart/alpine-node
ADD . .
RUN npm install
ENV port 80
EXPOSE 80
CMD ["node", "build/index.js"]
