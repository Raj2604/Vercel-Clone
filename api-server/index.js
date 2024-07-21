const express = require("express");
const { generateSlug } = require("random-word-slugs");
const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs");
const { Server } = require("socket.io");
const cors = require("cors");
const Redis = require("ioredis");
const {z} = require("zod");
const { PrismaClient } = require("@prisma/client"); 
const { createClient } = require("@clickhouse/client");
const {Kafka} = require("kafkajs");
const {v4: uuidv4} = require("uuid");
const { stat } = require("fs");
const app = express();
const fs = require("fs");
const path = require("path");
const PORT = 9000;


const prisma = new PrismaClient();

const io = new Server({ cors: "*" });

const kafka = new Kafka({
  clientId: `api-server`,
  brokers: [''],
  ssl: {
    ca : [fs.readFileSync(path.join(__dirname, ''), 'utf-8')],
  },
  sasl: {
    username: '',
    password: '',
    mechanism: ''
  }
});

const client = createClient({
  host: "",
  database: "",
  username: "",
  password: "",
});

const consumer = kafka.consumer({ groupId: "api-server-logs-consumer" });

io.on("connection", (socket) => {
  socket.on("subscribe", (channel) => {
    socket.join(channel);
    socket.emit("message", `Joined ${channel}`);
  });
});

io.listen(9002, () => console.log("Socket Server 9002"));

const ecsClient = new ECSClient({
  region: "",
  credentials: {
    accessKeyId: "",
    secretAccessKey: "",
  },
});

const config = {
  CLUSTER: "",
  TASK: "",
};

app.use(express.json());
app.use(cors());

app.post("/project", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    gitURL: z.string()
  });
  const safeParseResult = schema.safeParse(req.body);

  if(safeParseResult.error) return res.status(400).json({error: safeParseResult.error});

  const { name, gitURL } = safeParseResult.data;

  const project = await prisma.project.create({
    data: {
      name,
      gitURL,
      subDomain: generateSlug()
    }
  });
  return res.json({status: "success", data: {project}});
});
app.post("/deploy", async (req, res) => {
  const {projectID} = req.body;
  const project = await prisma.project.findUnique({ where: { id: projectID } }); 

  if(!project) return res.status(404).json({error: "Project not found"});

  //check if there is no running deployment
  const deployment = await prisma.deployment.create({
    data : {
      project: {
        connect: {
          id: project.id
        }
      },
      status: "QUEUED"
    }
  });

  // Spin the container
  const command = new RunTaskCommand({
    cluster: config.CLUSTER,
    taskDefinition: config.TASK,
    launchType: "FARGATE",
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        assignPublicIp: "ENABLED",
        subnets: ["", "", ""],
        securityGroups: [""],
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: "builder-image",
          environment: [
            { name: "GIT_REPOSITORY__URL", value: project.gitURL },
            { name: "PROJECT_ID", value: projectID },
            { name: "DEPLOYMENT_ID", value: deployment.id },
          ],
        },
      ],
    },
  });

  await ecsClient.send(command);

  return res.json({
    status: "queued",
    data: { deploymentID: deployment.id },
  });
});

app.get("/logs/:id", async (req, res) => {
  const id = req.params.id;
  const logs = await client.query({
    query: `SELECT event_id, deployment_id, log, timestamp from log_events where deployment_id = {deployment_id:String}`,
    query_params: {
      deployment_id: id
    },
    format: 'JSONEachRow'
  })

  const rawLogs = await logs.json()

  return res.json({ logs: rawLogs })
});

async function initkafkaConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topics: ['container-logs'] });

  await consumer.run({
    autoCommit: false,
    eachBatch: async function({ batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }) {
      const messages = batch.messages;
      console.log(`Recv. ${messages.length} messages..`);
      for (const message of messages) {
        if(!message.value) continue;
        const stringMessage = message.value.toString();
        const { PROJECT_ID, DEPLOYMENT_ID, log } = JSON.parse(stringMessage);
        try {
          const { query_id } = await client.insert({
            table: 'log_events',
            values: [{ event_id: uuidv4(), deployment_id: DEPLOYMENT_ID, log }],
            format: 'JSONEachRow'
          });
          console.log(query_id);
          resolveOffset(message.offset);
          await commitOffsetsIfNecessary(message.offset);
          await heartbeat();
        } catch (error) {
          console.error(error);
        }
        
      }
    }
  });
}
initkafkaConsumer();
app.listen(PORT, () => console.log(`API Server Running..${PORT}`));