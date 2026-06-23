declare module 'spark-md5' {
  class SparkMD5ArrayBuffer {
    append(data: globalThis.ArrayBuffer): SparkMD5ArrayBuffer;
    end(raw?: boolean): string;
  }

  export default class SparkMD5 {
    static ArrayBuffer: typeof SparkMD5ArrayBuffer;
    append(data: string): SparkMD5;
    end(raw?: boolean): string;
  }
}
