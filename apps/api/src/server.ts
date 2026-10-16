import Fastify from "fastify";

const fastify = Fastify({
  logger: true,
});

fastify.get("/", function (_request, reply) {
  reply.send({
    success: true,
    hello: "Welcome to Circuit - Visual Workflow Automation Platform",
  });
});

const start = async () => {
  try {
    await fastify.listen({ port: 4000 });
    fastify.log.info("Server is now listening on localhost:4000");
  } catch (error) {
    (fastify.log.error(error), process.exit(1));
  }
};

start();
