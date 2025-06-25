import Head from "next/head";
import AlbumExplorer from "../components/AlbumExplorer";

export default function Home() {
  return (
    <>
      <Head>
        <title>Careers in Music</title>
        <meta name="description" content="Explore musicians' careers through album connections" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <AlbumExplorer />
    </>
  );
}
