/** Flat sidebar section: small caps heading over content, separated from its neighbours by a hairline. No card chrome. */
export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="sec">
      <div className="sec-h"><h3 className="h">{title}</h3>{aside}</div>
      {children}
    </section>
  );
}
