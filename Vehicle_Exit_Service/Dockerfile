FROM node:16

WORKDIR /Vehicle_Exit_Service

COPY package*.json ./

RUN npm install

COPY . .

COPY .env ./

EXPOSE 3002

CMD ["node", "Exit_Server.js"]