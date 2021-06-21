FROM node:12-alpine
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . .
RUN npm install
ENV DYNAMO_DB_TABLE nicepiano-recordings
EXPOSE 5000
CMD ["node", "server.js", "5000"]