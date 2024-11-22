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

async function connectMongo() {
  try {
    const mongoClient = new mongo.MongoClient(process.env.MONGO_URL);
    await mongoClient.connect();
    const database = mongoClient.db(process.env.MONGO_DB);
    collection = database.collection(process.env.MONGO_COL);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}


let rabbitChannel;
async function connectToRabbitMQ() {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    rabbitChannel = await connection.createChannel();
    await rabbitChannel.assertQueue(process.env.QUEUE_NAME_ENTRY);
    await rabbitChannel.assertQueue(process.env.QUEUE_NAME_EXIT);
    processEntry(rabbitChannel);
    processExit(rabbitChannel);
    console.log('Connected to RabbitMQ');
  } catch (error) {
    console.error('Failed to connect to RabbitMQ:', error);
    process.exit(1);
  }
}


async function processEntry(rabbitChannel) {
  rabbitChannel.consume(process.env.QUEUE_NAME_ENTRY, async (msg) => {
    if (msg) {
      console.log(`Received entry message: ${msg.content.toString()}`);
      const message = JSON.parse(msg.content.toString());
      const { fileName } = message;
      const { email } = message;

      try {
        await processEntryImage(fileName, email);
      } catch (error) {
        console.error('Error processing entry image:', error);
      } finally {
        rabbitChannel.ack(msg);
      }
    }
  });
}


async function processEntryImage(fileName, email) {
  const localFilePath = path.join(__dirname, fileName);
  const bucketName = process.env.MINIO_BUCKET;

  try {
    await minioClient.fGetObject(bucketName, fileName, localFilePath);
    const number = await runALPR(localFilePath);
    const dateEntry = fileName.split("_")[0];

    await collection.insertOne({
      Plate: number,
      time_arrive: dateEntry,
      time_exit: "",
      time_spent: "",
      email: email
    });

    console.log(`Entry image processed for Plate: ${number}`);
  } finally {
    deleteLocalFile(localFilePath);
  }
}


async function processExit(rabbitChannel) {
  rabbitChannel.consume(process.env.QUEUE_NAME_EXIT, async (msg) => {
    if (msg) {
      console.log(`Received exit message: ${msg.content.toString()}`);
      const message = JSON.parse(msg.content.toString());
      const { fileName } = message;

      try {
        await processExitImage(fileName);
      } catch (error) {
        console.error('Error processing exit image:', error);
      } finally {
        rabbitChannel.ack(msg);
      }
    }
  });
}


async function processExitImage(fileName) {
  const localFilePath = path.join(__dirname, fileName);
  const bucketName = process.env.MINIO_BUCKET;

  try {
    await minioClient.fGetObject(bucketName, fileName, localFilePath);
    const number = await runALPR(localFilePath);
    const dateExit = fileName.split("_")[0];
    const user = await collection.findOne({ Plate: number }, { sort: { _id: -1 } });

    if (user) {
      const timeSpent = parseInt(dateExit) - parseInt(user.time_arrive);
      await collection.updateOne({ Plate: number }, { $set: { time_exit: dateExit, time_spent: timeSpent } });
      const timeSpentHuman = await dhm(timeSpent);

      const mailOptions = {
        from: 'MS_O67v3Y@trial-o65qngky8qolwr12.mlsender.net',
        to: user.email,
        subject: `Your plate number: ${number}`,
        text: `Time spent: ${timeSpentHuman}`
      };
      await transporter.sendMail(mailOptions);
      console.log(`Exit image processed and email sent to ${user.email}`);
    }
  } finally {
    deleteLocalFile(localFilePath);
  }
}


function deleteLocalFile(filePath) {
  fs.unlink(filePath, (err) => {
    if (err) console.error('Failed to delete local file:', err);
    else console.log(`Deleted local file: ${filePath}`);
  });
}


async function dhm(ms) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const daysms = ms % (24 * 60 * 60 * 1000);
  const hours = Math.floor(daysms / (60 * 60 * 1000));
  const hoursms = ms % (60 * 60 * 1000);
  const minutes = Math.floor(hoursms / (60 * 1000));
  const sec = Math.floor((ms % (60 * 1000)) / 1000);
  return `${days} days ${hours} hours ${minutes} mins ${sec} secs`;
}


async function runALPR(fileName) {
  return new Promise((resolve, reject) => {
    const command = `alpr -c eu -j ${fileName}`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('ALPR execution failed:', error);
        reject(error);
      } else {
        const plateOutput = JSON.parse(stdout);
        resolve(plateOutput.results[0]?.plate || "Unknown");
      }
    });
  });
}


connectMongo();
connectToRabbitMQ().catch(console.error);


process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start server
app.listen(port, () => {
  console.log(`Vehicle ALPR Service running on port ${port}`);
});
