const {exec} = require('child_process');
const path = require('path');
const fs = require('fs');

const {S3Client,PutObjectCommand} = require('@aws-sdk/client-s3');
const mime = require('mime-types');
require('dotenv').config();
const s3Client = new S3Client({
    region: 'ap-south-1',
    credentials:{
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    }
})

const PROJECT_ID = process.env.PROJECT_ID

async function init() {
    console.log('Executing script.js')
    const outDirPath = path.join(__dirname, 'output')
    const p = exec(`cd ${outDirPath} && npm install && npm run build`)
    p.stdout.on('data', (data) => {
        console.log(data.toString())
    })
    p.stdout.on('error', (data) => {
        console.error('Error',data.toString())
    })
    p.on('close', async () => {
        console.log(`Build completed`);
        const distFolderPath = path.join(__dirname,'output','dist')
        console.log("Distfolderpath")
        const distFolderContents = fs.readdirSync(distFolderPath,{recursive:true})
        console.log("readdirsync")
        for(const file of distFolderContents){
            const filePath = path.join(distFolderPath,file)
            console.log("filepath")
            if(fs.lstatSync(filePath).isDirectory()){
                continue;
            }
            console.log('uploading',filePath)
            const command = new PutObjectCommand({
                Bucket: 'vercel-clone26',
                Key: `__outputs/${PROJECT_ID}/${file}`,
                Body: fs.createReadStream(filePath),
                ContentType: mime.lookup(filePath)
            })
            console.log("after put")
            await s3Client.send(command)
            console.log('Uploaded',filePath)
        }
        console.log('Done...')
    })
  
}

init()