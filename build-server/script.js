const {exec} = require('child_process');
const path = require('path');

const {S3Client,PutObjectCommand} = require('@aws-sdk/client-s3');
const mime = require('mime-types');
const { env } = require('process');
const S3Client = new S3Client({
    region: 'ap-south-1',
    credentials:{
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
})

const PROJECT_ID = process.env.PROJECT_ID

async function init() {
    console.log('Executing script.js')
    const outDirPath = path.join(__dirname, 'output')
    const p = exec(`cd ${outDirPath} && npm install && npm run build`)
    p.stdout.on('data', (data) => {
        console.log(data.tostring())
    })
    p.stdout.on('error', (data) => {
        console.error('Error',data.tostring())
    })
    p.on('close', async () => {
        console.log(`Build completed`);
        const distFolderPath = path.join(__dirname,'output','dist')
        const distFolderContents = fs.readdirSync(distFolderPath,{recursive:true})

        for(const filePath of distFolderContents){
            if(fs.lstatSync(filePath).isDirectory()){
                continue;
            }
            console.log('uploading',filePath)
            const command = new PutObjectCommand({
                Bucket: 'vercel-clone-26',
                Key: `__outputs/${PROJECT_ID}/${filePath}`,
                Body: fs.createReadStream(filePath),
                ContentType: mime.lookup(filePath),
            })

            await S3Client.send(command)
            console.log('Uploaded',filePath)
        }
        console.log('Done...')
    })
  
}

init()