const express = require('express');
const multer = require('multer');
const Minio = require('minio');
const amqp = require('amqplib');
const fs = require('fs');
const cors = require('cors');
require('dotenv').config();
console.log('MINIO_ENDPOINT:', process.env.MINIO_ENDPOINT);
console.log('MINIO_PORT:', process.env.MINIO_PORT);
console.log('MINIO_ACCESS_KEY:', process.env.MINIO_ACCESS_KEY);
console.log('MINIO_SECRET_KEY:', process.env.MINIO_SECRET_KEY);

const app = express();
app.use(cors());
const port = process.env.PORT || 3002;

// Configure Multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Configure Minio client
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT, 10),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

async function ensureMinioBucket(bucketName) {
    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName);
      console.log(`Bucket '${bucketName}' created in Minio.`);
    } else {
      console.log(`Bucket '${bucketName}' already exists in Minio.`);
    }
}

// Set up RabbitMQ connection
let rabbitChannel;
async function connectToRabbitMQ() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  rabbitChannel = await connection.createChannel();
  await rabbitChannel.assertQueue(process.env.QUEUE_NAME);
}

connectToRabbitMQ().catch(console.error);
const bucketName = process.env.MINIO_BUCKET;
ensureMinioBucket(bucketName);

// Endpoint to handle file upload for vehicle entry
app.post('/upload', upload.single('image'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send('No file uploaded.');

  const fileName = `${Date.now()}_${file.originalname}`;
  const bucket = process.env.MINIO_BUCKET;

  try {
    // Save file to Minio
    await minioClient.fPutObject(bucket, fileName, file.path);
    console.log(`File uploaded to Minio: ${fileName}`);

    // Publish message to RabbitMQ with file name
    const message = JSON.stringify({ fileName, eventType: 'exit' });
    rabbitChannel.sendToQueue(process.env.QUEUE_NAME, Buffer.from(message));
    console.log(`Message sent to RabbitMQ: ${message}`);

    res.send('File uploaded and processed successfully.');
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).send('Failed to process the file.');
  } finally {
    // Delete the local file after upload
    fs.unlinkSync(file.path);
  }
});

app.listen(port, () => {
  console.log(`Vehicle Exit Service running on port ${port}`);
});