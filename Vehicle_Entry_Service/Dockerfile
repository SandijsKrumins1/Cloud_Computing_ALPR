FROM node:16

WORKDIR /Vehicle_Entry_Service

COPY package*.json ./

RUN npm install

COPY . .

COPY .env ./

EXPOSE 3001

CMD ["node", "Entry_Server.js"]