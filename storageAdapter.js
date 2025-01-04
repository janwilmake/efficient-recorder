"use strict";

import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { promises } from "fs";
import { join } from "path";

/*
 * Returns an object with two upload methods: storeImage and storeAudio
 * The behavior depends on the specified mode: 's3' or 'local'
 *
 * @param {Object} opts
 * @param {string} opts.mode - The storage target, either 's3' or 'local'
 * @param {string} [opts.endpoint] - S3 endpoint
 * @param {string} [opts.region] - S3 region
 * @param {string} [opts.accessKeyId] - AWS access key
 * @param {string} [opts.secretAccessKey] - AWS secret key
 * @param {string} [opts.localDirectory] - Local directory path for storing files
 */
function createStorageAdapter(opts = {}) {
  if (opts.mode === "s3") {
    const s3Client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      forcePathStyle: true,
    });

    return {
      /*
       * Uploads an image buffer to S3
       *
       * @param {Buffer} buffer - Image data
       * @param {string} type - The type of image ("screenshot" or "webcam")
       * @param {string} timestamp - Timestamp used for creating key
       */
      async storeImage(buffer, type, timestamp) {
        const extension = type === "webcam" ? ".jpg" : ".png";
        const params = {
          Bucket: "recordings",
          Key: `${type}-${timestamp}${extension}`,
          Body: buffer,
          ContentType: type === "webcam" ? "image/jpeg" : "image/png",
        };

        const upload = new Upload({ client: s3Client, params });
        const result = await upload.done();
        return result.Key;
      },

      /*
       * Uploads an audio buffer to S3
       *
       * @param {Buffer} buffer - Audio data
       * @param {string} timestamp - Timestamp used for creating key
       */
      async storeAudio(buffer, timestamp) {
        const params = {
          Bucket: "recordings",
          Key: `recording-${timestamp}.wav`,
          Body: buffer,
          ContentType: "audio/wav",
        };

        const upload = new Upload({ client: s3Client, params });
        const result = await upload.done();
        return result.Key;
      },
    };
  } else if (opts.mode === "local") {
    if (!opts.localDirectory) {
      throw new Error("Local directory path is required for local mode");
    }

    return {
      /*
       * Saves an image buffer to the local filesystem
       *
       * @param {Buffer} buffer - Image data
       * @param {string} type - The type of image ("screenshot" or "webcam")
       * @param {string} timestamp - Timestamp used for creating filename
       */
      async storeImage(buffer, type, timestamp) {
        const extension = type === "webcam" ? ".jpg" : ".png";
        const filename = `${type}-${timestamp}${extension}`;
        const filePath = join(opts.localDirectory, filename);

        await promises.writeFile(filePath, buffer);
        return filePath;
      },

      /*
       * Saves an audio buffer to the local filesystem
       *
       * @param {Buffer} buffer - Audio data
       * @param {string} timestamp - Timestamp used for creating filename
       */
      async storeAudio(buffer, timestamp) {
        const filename = `recording-${timestamp}.wav`;
        const filePath = join(opts.localDirectory, filename);

        await promises.writeFile(filePath, buffer);
        return filePath;
      },
    };
  } else {
    throw new Error("Invalid mode specified. Use 's3' or 'local'.");
  }
}

export default { createStorageAdapter };
