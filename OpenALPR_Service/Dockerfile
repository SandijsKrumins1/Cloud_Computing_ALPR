FROM openalpr/openalpr

WORKDIR /OpenALPR_Service

COPY package*.json ./

RUN curl -sL https://deb.nodesource.com/setup_16.x -o /tmp/nodesource_setup.sh

RUN bash /tmp/nodesource_setup.sh

RUN apt install nodejs

RUN npm install

COPY . .

COPY .env ./

EXPOSE 3003

CMD ["node", "OpenALPR_Server.js"]