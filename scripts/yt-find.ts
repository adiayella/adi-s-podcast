import "./env";
const key = process.env.YOUTUBE_API_KEY!;
const shows = ["Figuring Out with Raj Shamani","The Ranveer Show","WTF is with Nikhil Kamath","SparX by Mukesh Bansal","The Neon Show Siddhartha Ahluwalia","Founder Thesis Akshay Datt","The Indian Startup Show Neil Patel","Prime Venture Partners Podcast","The Daily Brief Zerodha","The Morning Brief Economic Times podcast"];
async function main() {
  for (const q of shows) {
    const s = await (await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=3&q=${encodeURIComponent(q)}&key=${key}`)).json();
    const ids = (s.items ?? []).map((i: any) => i.snippet.channelId).join(",");
    const c = ids ? await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${ids}&key=${key}`)).json() : { items: [] };
    console.log(`\n${q}`);
    for (const i of c.items ?? []) console.log(`  ${i.id} | ${i.snippet.title} | subs ${i.statistics.subscriberCount} | videos ${i.statistics.videoCount} | ${i.snippet.customUrl ?? ""}`);
    if (s.error) console.log("  ERR", s.error.message);
  }
}
main();
