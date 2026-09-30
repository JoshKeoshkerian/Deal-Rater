from docx import Document
p='output/documents/Curbside_Executive_Summary.docx';d=Document(p)
for x in d.paragraphs:
 if x.text.startswith('[Founder name,'):
  x.text='Joshua Keoshkerian, co-founder, studies Business Information Systems with minors in Mathematics and Computer Science at the University of Tulsa. He developed Curbside’s working extension and evaluation engine. At the Federal Reserve Bank of Kansas City, he won first place in a bank-wide intern data visualization competition and presented analytical findings to executive leadership. At Royal Banks of Missouri, he reworked an anomaly-detection system that helped prevent over $5,000 in fraudulent transactions. This experience supports Curbside’s work translating complex data into useful buying guidance.'
 elif x.text.startswith('The venture needs capabilities'):
  x.text='Ryan Calhoun, co-founder, is a National Merit Scholar studying Engineering Physics with a focus on Bioengineering at the University of Tulsa, with a 4.0 GPA. As a traffic engineering intern for the City of Sioux Falls, he used Excel to automate traffic-data analysis and support senior engineers’ decisions. At The Mitographers, he prepared digital production files to reduce machine downtime and improve efficiency. His quantitative and mechanical experience supports product evaluation, while his roles as club soccer president, treasurer, and peer mentor demonstrate leadership.'
 elif x.text.startswith('We will use customer interviews, independent'):
  x.text='Together, the founders bring business analysis, software development, engineering, and experience communicating technical findings. Their university networks provide access to students and first-time buyers for early research. As Curbside expands into purchase support and institutional software, the team plans to seek automotive and industry advisors and targeted expertise in partnerships, security, and integrations.'
d.save(p)
