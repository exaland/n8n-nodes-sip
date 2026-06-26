FROM node:22-alpine

WORKDIR /app

COPY . . 

RUN cd worker && npm install

COPY . .

##RUN cd worker && npm run start

CMD ["node", "--import", "tsx", "src/server.ts"]