import { getSiteEdition } from "@/lib/site-edition";
import { AnniversaryHero } from "@/components/anniversary/AnniversaryHero";
import { ClassicHero } from "./ClassicHero";
export function Hero(props: {
  slogan: string;
  name?: string;
  description?: string;
}) {
  return getSiteEdition() === "classic" ? (
    <ClassicHero {...props} />
  ) : (
    <AnniversaryHero {...props} />
  );
}
