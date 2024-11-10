const express = require('express');
const multer = require('multer');
const Minio = require('minio');
const amqp = require('amqplib');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const exec = require('child_process').exec;
const mongo = require('mongodb');
const nodemailer = require('nodemailer');
require('dotenv').config();
const app = express();
app.use(cors());
const port = process.env.PORT || 3003;


const transporter = nodemailer.createTransport({
    host: "smtp.mailersend.net",
    port: 587,
    secure: false,
    auth: {
      user: 'MS_O67v3Y@trial-o65qngky8qolwr12.mlsender.net',
      pass: 'Or35Lsm11ndDVJOd'
    }
});

const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT,
    port: parseInt(process.env.MINIO_PORT, 10),
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
});

let collection;

async function connectMongo(){
    const mongoClient = new mongo.MongoClient(process.env.MONGO_URL);
    await mongoClient.connect();
    const database = mongoClient.db(process.env.MONGO_DB);
    collection = database.collection(process.env.MONGO_COL);
}

let rabbitChannel;

async function connectToRabbitMQ() {
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    rabbitChannel = await connection.createChannel();
    await rabbitChannel.assertQueue(process.env.QUEUE_NAME_ENTRY);
    await rabbitChannel.assertQueue(process.env.QUEUE_NAME_EXIT);
    processEntry(rabbitChannel);
    processExit(rabbitChannel);
}

async function processEntry(rabbitChannel){
    rabbitChannel.consume(process.env.QUEUE_NAME_ENTRY, (msg) => {
        if (msg !== null) {
            console.log(`Received message: ${msg.content.toString()}`);
            const message = JSON.parse(msg.content.toString());
            const { fileName, eventType } = message;
            processEntryImage(fileName);
            rabbitChannel.ack(msg);
        }
    });
}


async function processEntryImage(fileName) {
    const bucketName = process.env.MINIO_BUCKET;
    await minioClient.fGetObject(bucketName, fileName, path.join(__dirname, fileName));
    let number = await runALPR(fileName);
    console.log(number);
    let dateEntry = fileName.split("_");
    console.log(dateEntry[0])
    collection.insertOne( { Plate: number , time_arrive: dateEntry[0] , time_exit:"" , time_spent: "", email:"openalprsandijskrumins@gmail.com" } );
}

async function processExit(rabbitChannel){
    rabbitChannel.consume(process.env.QUEUE_NAME_EXIT, (msg) => {
        if (msg !== null) {
            console.log(`Received message: ${msg.content.toString()}`);
            const message = JSON.parse(msg.content.toString());
            const { fileName, eventType } = message;
            processExitImage(fileName);
            rabbitChannel.ack(msg);
        }
    });
}


async function processExitImage(fileName) {
    const bucketName = process.env.MINIO_BUCKET;
    await minioClient.fGetObject(bucketName, fileName, path.join(__dirname, fileName));
    let number = await runALPR(fileName);
    console.log(number);
    let dateExit = fileName.split("_");
    console.log(dateExit[0])
    const user = await collection.findOne({ Plate: number }, { projection: { time_arrive: 1 , email: 1 } },{sort: { _id: -1 }});
    let timeSpent = parseInt(dateExit[0]) - parseInt(user.time_arrive) ;
    collection.updateOne({ Plate: number },{ $set: {time_exit: dateExit[0], time_spent: timeSpent}},{sort: { _id: -1 }});
    let timeSpentHuman = await dhm(timeSpent);
    let mailOptions = {
        from: 'MS_O67v3Y@trial-o65qngky8qolwr12.mlsender.net',
        to: user.email,
        subject: `jūsu numurzīmes numurs : ${number}`,
        text: `Ir pavadijis : ${timeSpentHuman}`
    };
    transporter.sendMail(mailOptions, function(error, info){
        if (error) {
          console.log(error);
        } else {
          console.log('Email sent: ' + info.response);
        }
    });
}
async function dhm (ms) {
    const days = Math.floor(ms / (24*60*60*1000));
    const daysms = ms % (24*60*60*1000);
    const hours = Math.floor(daysms / (60*60*1000));
    const hoursms = ms % (60*60*1000);
    const minutes = Math.floor(hoursms / (60*1000));
    const minutesms = ms % (60*1000);
    const sec = Math.floor(minutesms / 1000);
    return days + " days " + hours + " hours " + minutes + " mins " + sec + " secs ";
  }

async function runALPR(fileName){
    return new Promise((resolve,reject) => {
        const command = `alpr -c eu -p lv -j ${fileName}`;
        exec(command, (error, stdout, stderr) => {
            let plateOutput = JSON.parse(stdout.toString());
            console.log(plateOutput);
            resolve(plateOutput.results[0].plate);
        });
    });
}

connectToRabbitMQ().catch(console.error);
connectMongo();

app.listen(port, () => {
    console.log(`Vehicle ALPR Service running on port ${port}`);
  });