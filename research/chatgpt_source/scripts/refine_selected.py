#!/usr/bin/env python3
"""Targeted AI-authored, source-checked refinements. Not human review.

The book/question selections are explicit; a missing evidence pattern is reported
instead of invented. These changes are isolated from Claude's existing work.
"""
import argparse,json,re
from pathlib import Path
from label_catalog import QID,sentence_at

SELECTIONS={
 'The Hunger Games':{1:r'16.year.old Katniss',2:r'Katniss Everdeen, a girl',3:r'male tribute[^.]{0,80}Peeta',23:r'destruction of the continent.s civilization[^.]{0,50}apocalyptic',28:r'fight to the death',31:r'annual lottery[^.]{0,160}Hunger Games',44:r'wealthy Capitol and twelve surrounding, poorer districts'},
 "Harry Potter and the Philosopher's Stone":{1:r'eleventh birthday',6:r'accepted at Hogwarts',8:r'Harry is a wizard',9:r'Hogwarts',13:r'Diagon Alley[^.]{0,90}London',32:r'wizard'},
 'Twilight':{2:r'Isabella "Bella" Swan',6:r'her new school',8:r'vampire',26:r'(?:love|romance|relationship)'},
 'To Kill a Mockingbird':{14:r'Alabama',18:r'Great Depression',44:r'(?:racism|racial|black man)'},
 'The Great Gatsby':{3:r'narrator, Nick Carraway',10:r'New York',14:r'Long Island',18:r'summer of 1922',26:r'(?:love|romance|affair)'},
 'The Fault in Our Stars':{1:r'sixteen.year.old girl',2:r'Hazel Grace Lancaster',39:r'terminal cancer',26:r'(?:fall[^.]{0,12}in love|romantic|kiss)'},
 'The Catcher in the Rye':{1:r'Seventeen.year.old Holden',3:r'Holden Caulfield',19:r'majority of the novel takes place[^.]{0,60}1949'},
 'Nineteen Eighty-Four':{13:r'Airstrip One \(England or Britain\)',23:r'after a global atomic war',26:r'illicit romance with Julia',30:r'intellectual rebellion against the Party'},
 'Animal Farm':{5:r'two young pigs, Snowball and Napoleon',11:r'Manor Farm',36:r'animals[^.]{0,160}song',44:r'humans to parasites'},
 'The Kite Runner':{1:r'Amir[^.]{0,60}boy',3:r'Amir[^.]{0,60}boy',10:r'city of Kabul'},
 'The Help':{2:r'perspectives of three women',4:r'perspectives of three women',14:r'Jackson, Mississippi',19:r'early 1960s',49:r'first.person perspectives',50:r'first.person perspectives of three women'},
 'Of Mice and Men':{3:r'Two migrant field workers[^.]{0,160}man',14:r'California',18:r'Great Depression'},
 'The Lightning Thief':{1:r'twelve year old boy',3:r'Percy Jackson[^.]{0,40}boy',6:r'pre.algebra teacher',8:r'demigod',14:r'New York City',32:r'(?:gods|demigod|god)'},
 'A Game of Thrones':{4:r'three principal storylines simultaneously',15:r'Seven Kingdoms'},
 'Memoirs of a Geisha':{1:r'At the age of nine, Chiyo',2:r'Chiyo Sakamoto',38:r'geisha boarding house'},
 'The Giver':{1:r'twelve.year.old boy',3:r'boy named Jonas'},
 'Jane Eyre':{1:r'ten.year.old orphan named Jane',2:r'Jane Eyre',9:r'(?:Lowood|school)'},
 'City of Bones':{1:r'Fifteen.year.old',2:r'Clary Fray',10:r'Brooklynite',14:r'Brooklynite'},
 'New Moon':{1:r'18th birthday',2:r'Isabella "Bella" Swan',8:r'Edward Cullen, the vampire',26:r'vampire she loves'},
 'Breaking Dawn':{2:r'Bella.s marriage',8:r'vampire',26:r'marriage and honeymoon'},
 "Charlotte's Web":{1:r'eight.year.old daughter',2:r'daughter Fern',5:r'piglet Wilbur',36:r'(?:Charlotte[^.]{0,140}spider|spider[^.]{0,100}Charlotte)'},
 'Brave New World':{10:r'London',13:r'London',21:r'AD 2540'},
 'Northern Lights':{15:r'parallel world',32:r'(?:witch|magic)',5:r'sentient[^.]{0,20}d.mon'},
 'The Secret Life of Bees':{1:r'14.year.old Lily',2:r'Lily Melissa Owens',14:r'South Carolina',19:r'1964',29:r'abusive father'},
 'The Perks of Being a Wallflower':{1:r'adolescent narrator',6:r'first year of high school',9:r'high school',51:r'presented through letters'},
 'Gone with the Wind':{14:r'southern United States',17:r'American Civil War \(1861',24:r'American Civil War'},
 'The Curious Incident of the Dog in the Night-time':{1:r'fifteen.year.old boy',3:r'Christopher[^.]{0,40}boy'},
 "My Sister's Keeper":{2:r'Anna Fitzgerald',14:r'Rhode Island',20:r'Rhode Island in 2004',39:r'acute promyelocytic leukemia'},
 'A Thousand Splendid Suns':{4:r'first part focuses exclusively on Mariam',50:r'switches focus between Mariam and Laila'},
 "The Time Traveler's Wife":{4:r'alternating first.person perspectives',10:r'Chicago',14:r'Chicago',33:r'(?:time travel|time.travel|Chrono.Displacement)',39:r'rare genetic disorder',49:r'alternating first.person perspectives',50:r'alternating first.person perspectives'},
 'The Art of Racing in the Rain':{3:r'Denny Swift, a race car driver',5:r'his dog Enzo',10:r'living in Seattle',14:r'living in Seattle',29:r'child.custody battle'},
 'The Grapes of Wrath':{3:r'Tom Joad',14:r'Sallisaw, Oklahoma',27:r'journey',44:r'banks have evicted all the farmers'},
 'East of Eden':{11:r'Salinas Valley',14:r'Salinas Valley, California',18:r'beginning of the 20th century and the end of World War I',24:r'World War I'},
 'Flowers for Algernon':{3:r'protagonist, Charlie Gordon, a man',38:r'janitor in a factory',51:r'series of journal entries'},
 'An Abundance of Katherines':{1:r'seventeen year old boy',3:r'Colin Singleton',11:r'rural town',14:r'Gutshot, Tennessee',26:r'girlfriend[^.]{0,120}dumped him',27:r'road trip'},
 'The Voyage of the Dawn Treader':{1:r'two youngest Pevensie children',15:r'Narnian world',16:r'aboard[^.]{0,35}Dawn Treader|ship at sea',27:r'find the seven lost Lords',36:r'Talking Mouse Reepicheep'},
 'The Graveyard Book':{1:r'toddler',3:r'baby is named Nobody Owens',35:r'ghosts accept'},
 'The Son of Neptune':{4:r'He and Hazel and Frank',8:r'two other demigods',27:r'quest to free Thanatos'},
 'Anna Karenina':{10:r'Moscow',26:r'proposing to[^.]{0,90}Princess'},
 'The Old Man and the Sea':{3:r'(?:Santiago|old man)',16:r'(?:sea|fishing)'},
 'The Two Towers':{5:r'[Hh]obbits?',15:r'(?:Middle.earth|Rohan|Gondor)',32:r'wizard'},
 'The Lord of the Rings':{5:r'[Hh]obbits?',15:r'Middle.earth',32:r'wizard',27:r'quest'},
 'The Hitchhiker\'s Guide to the Galaxy':{3:r'Arthur Dent',34:r'(?:spaceship|space|galaxy)'},
 'Watership Down':{5:r'rabbits',36:r'rabbits'},
 'Black Beauty':{5:r'horse'},
 'White Fang':{5:r'wolf.dog hybrid'},
 'The Call of the Wild':{5:r'(?:Buck[^.]{0,100}dog|dog[^.]{0,100}Buck)'},
 'The Wind in the Willows':{5:r'(?:Mole|Water Rat|Mr. Toad)',36:r'(?:Mole|Water Rat|Mr. Toad)'},
 'The Tale of Despereaux':{5:r'mouse',36:r'mouse'},
 'The Power of Six':{4:r'various members of the Garde',50:r'story is told by various members'},
 'The Alienist':{3:r'John Moore',10:r'New York',14:r'New York',49:r'first.person perspective'},
 'Elantris':{4:r'three principal characters',50:r'one for each of the three main characters'},
 'People of the Book':{2:r'Hanna Heath',22:r'history of the Haggadah',52:r'alternates between sections set in the present day'},
 'We Need to Talk About Kevin':{2:r'Eva.s narration',51:r'narration takes the form of letters'},
 'Blindness':{10:r'unnamed city',39:r'mass epidemic of blindness'},
 'The Black Echo':{3:r'Harry Bosch',7:r'police detective'},
 'The Surgeon':{2:r'Jane Rizzoli',7:r'detective Thomas Moore',10:r'Boston',14:r'Boston',25:r'works the case'},
 'Contact':{2:r'Eleanor "Ellie" Arroway',14:r'New Mexico'},
 'Old Man\'s War':{3:r'John Perry, a 75.year old',34:r'interplanetary colonists'},
 'Rendezvous with Rama':{21:r'2077',23:r'After a major disaster',34:r'alien star ship'},
 'North and South':{1:r'Margaret Hale, 19',2:r'Margaret Hale',11:r'idyllic southern village',13:r'Helstone'},
 'Empire Falls':{11:r'Set in the small[^.]{0,70}town',14:r'Empire Falls, Maine',38:r'manager of the Empire Grill'},
 'Daughter of Fortune':{1:r'young Chilean girl',2:r'Eliza Sommers',17:r'Chile during the 1840s'},
 'Life As We Knew It':{1:r'Sixteen.year.old Miranda',2:r'Miranda',14:r'Pennsylvania, United States',29:r'parents are divorced'},
 'About a Boy':{1:r'bullied 12.year.old',3:r'Will Freeman[^.]{0,90}Marcus',4:r'Will Freeman[^.]{0,90}Marcus'},
 'The Plague':{39:r'(?:plague|epidemic)'},
 'The Boy in the Striped Pyjamas':{1:r'(?:nine.year.old|Bruno)',24:r'(?:World War|Nazi|Auschwitz)'},
 'All Quiet on the Western Front':{3:r'Paul B.umer',24:r'World War I'},
 'The Hunt for Red October':{16:r'submarine'},
 'Treasure Island':{16:r'(?:ship|sea)',27:r'(?:voyage|treasure)'},
 'The Picture of Dorian Gray':{3:r'Dorian Gray'},
 'The Shining':{35:r'ghost',29:r'rebuild his marriage'},
 'The Lion, the Witch and the Wardrobe':{1:r'four children',4:r'four siblings',13:r'English countryside',15:r'Narnia',24:r'World War II',32:r'Witch'},
 'Stranger in a Strange Land':{5:r'(?:Martian|Mars)'},
}

# These are specific semantic corrections to known draft false positives.
REVOKE={
 'The Hunger Games':[30], # citation describes the earlier rebellion, not the main plot
 'The Great Gatsby':[1,24], # incidental child and the narrator's earlier war service
 'Of Mice and Men':[2], # an incident involving a woman is not proof of a female central character
 'The Help':[1], # children in a maid's care are not established focal protagonists
 "Harry Potter and the Deathly Hallows":[9], # not returning to school does not establish school as a major setting
 'Breaking Dawn':[1], # the pregnancy alone does not establish an under-20 protagonist
 'Stranger in a Strange Land':[5], # a human raised on Mars remains human
}

def refine(labels,catalog,methods):
    by_title={r['title']:r for r in catalog};by_id={r['book_id']:r for r in labels['books']}
    applied=[];unmatched=[]
    for title,entries in SELECTIONS.items():
        r=by_title.get(title)
        if r is None:unmatched.append({'title':title,'reason':'title not in catalog'});continue
        cells={c['question_id']:c for c in by_id[r['id']]['answers']}
        for q,pattern in entries.items():
            m=re.search(pattern,r['synopsis']['text'],re.I)
            if not m:
                unmatched.append({'title':title,'question_id':QID(q),'pattern':pattern});continue
            quote=sentence_at(r['synopsis']['text'],m.start(),m.end())
            cells[QID(q)].update(p_yes=.7,status='supported',source_id=r['synopsis']['source_id'],
                evidence_quote=quote,premise_safe=True,reviewed=False)
            methods[r['id']][QID(q)]={'method':'targeted_AI_authored_draft','rule':pattern,
                'match_start':m.start(),'review_required':True,'human_reviewed':False}
            applied.append({'book_id':r['id'],'question_id':QID(q)})
    for title,questions in REVOKE.items():
        if title not in by_title:continue
        r=by_title[title]
        for c in by_id[r['id']]['answers']:
            if int(c['question_id'][1:]) in questions:
                c.update(p_yes=.5,status='insufficient_evidence',source_id=None,evidence_quote=None,premise_safe=False,reviewed=False)
                methods[r['id']].pop(c['question_id'],None)
    return {'applied_source_checked_refinements':len(applied),'unmatched_evidence_requests':unmatched,
            'note':'AI-authored draft selections with exact source quotes; not human-reviewed.'}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);args=ap.parse_args();root=args.root
    p=root/'data/core500_draft_labels.json';mp=root/'data/label_methods.json'
    labels=json.loads(p.read_text(encoding='utf-8'));methods=json.loads(mp.read_text(encoding='utf-8'))
    catalog=[json.loads(s) for s in (root/'data/priority_500.jsonl').read_text(encoding='utf-8').splitlines()]
    report=refine(labels,catalog,methods)
    p.write_text(json.dumps(labels,ensure_ascii=False,indent=2),encoding='utf-8')
    mp.write_text(json.dumps(methods,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/'reports/refinement_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'applied':report['applied_source_checked_refinements'],'unmatched':len(report['unmatched_evidence_requests'])}))

if __name__=='__main__':main()
