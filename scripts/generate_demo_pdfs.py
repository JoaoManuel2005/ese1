"""
Generate dummy PDF documents for RAG demo purposes.
Creates realistic financial documents with various types of content.
"""
import os
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib import colors
from datetime import datetime, timedelta

def create_quarterly_report(filename, company_name, quarter, year):
    """Create a quarterly financial report PDF"""
    doc = SimpleDocTemplate(filename, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []
    
    # Title
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#003366'),
        spaceAfter=30,
        alignment=1  # Center
    )
    
    story.append(Paragraph(f"{company_name}", title_style))
    story.append(Paragraph(f"Quarterly Financial Report - Q{quarter} {year}", styles['Heading2']))
    story.append(Spacer(1, 0.3*inch))
    
    # Executive Summary
    story.append(Paragraph("Executive Summary", styles['Heading2']))
    exec_summary = f"""
    This quarterly report presents the financial performance of {company_name} for Q{quarter} {year}.
    The company has shown strong revenue growth of 12% year-over-year, driven by increased market share
    in our core products and successful expansion into new markets. Net income increased by 8% compared
    to the same quarter last year, demonstrating operational efficiency improvements.
    """
    story.append(Paragraph(exec_summary, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Financial Highlights
    story.append(Paragraph("Financial Highlights", styles['Heading2']))
    
    revenue_base = 45000000 + (quarter * 2000000)
    data = [
        ['Metric', 'Current Quarter', 'Previous Quarter', 'YoY Change'],
        ['Revenue', f'${revenue_base:,}', f'${revenue_base-3000000:,}', '+12%'],
        ['Operating Income', f'${revenue_base//4:,}', f'${revenue_base//4-500000:,}', '+8%'],
        ['Net Income', f'${revenue_base//5:,}', f'${revenue_base//5-400000:,}', '+7%'],
        ['EPS', '$2.45', '$2.28', '+7.5%'],
        ['Operating Margin', '25.2%', '24.8%', '+0.4pp']
    ]
    
    table = Table(data, colWidths=[2.5*inch, 1.5*inch, 1.5*inch, 1.2*inch])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#003366')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    
    story.append(table)
    story.append(Spacer(1, 0.3*inch))
    
    # Business Overview
    story.append(Paragraph("Business Performance Analysis", styles['Heading2']))
    business_text = f"""
    During Q{quarter} {year}, {company_name} demonstrated robust performance across all business segments.
    Our product division saw a 15% increase in sales volume, while our services division grew by 18%.
    The international markets contributed 35% of total revenue, up from 32% in the previous quarter.
    
    Key achievements include:
    • Launched three new products that exceeded initial sales projections
    • Expanded operations into two new geographic markets
    • Achieved cost savings of $2.5M through operational improvements
    • Increased customer retention rate to 94%
    • Signed five major enterprise contracts worth $12M in annual recurring revenue
    """
    story.append(Paragraph(business_text, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Market Outlook
    story.append(Paragraph("Market Outlook", styles['Heading2']))
    outlook_text = f"""
    Looking ahead, we remain optimistic about our growth prospects. Industry analysts project
    market growth of 8-10% annually over the next three years. We are well-positioned to
    capitalize on emerging opportunities in digital transformation and cloud services.
    
    Our strategic priorities for the coming quarter include:
    1. Accelerating product innovation and development
    2. Expanding our customer base in high-growth markets
    3. Investing in technology infrastructure and talent
    4. Maintaining operational excellence and cost discipline
    """
    story.append(Paragraph(outlook_text, styles['BodyText']))
    story.append(Spacer(1, 0.3*inch))
    
    # Footer
    footer_text = f"Report Generated: {datetime.now().strftime('%B %d, %Y')}"
    story.append(Paragraph(footer_text, styles['Italic']))
    
    doc.build(story)
    print(f"Created: {filename}")

def create_investment_policy(filename):
    """Create an investment policy document"""
    doc = SimpleDocTemplate(filename, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []
    
    # Title
    story.append(Paragraph("Investment Policy Statement", styles['Title']))
    story.append(Spacer(1, 0.3*inch))
    story.append(Paragraph("Effective Date: January 1, 2024", styles['Heading3']))
    story.append(Spacer(1, 0.2*inch))
    
    # Introduction
    story.append(Paragraph("1. Introduction", styles['Heading2']))
    intro_text = """
    This Investment Policy Statement (IPS) establishes the guidelines and framework for managing
    the investment portfolio. The primary objectives are capital preservation, income generation,
    and long-term capital appreciation while maintaining an appropriate level of risk.
    """
    story.append(Paragraph(intro_text, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Investment Objectives
    story.append(Paragraph("2. Investment Objectives", styles['Heading2']))
    objectives_text = """
    The investment portfolio shall be managed to achieve the following objectives:
    
    • Generate a total return of CPI + 4% over rolling 5-year periods
    • Maintain sufficient liquidity to meet anticipated cash flow requirements
    • Preserve capital and minimize downside risk during market downturns
    • Achieve diversification across asset classes, sectors, and geographies
    • Maintain tax efficiency in investment strategy and execution
    """
    story.append(Paragraph(objectives_text, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Asset Allocation
    story.append(Paragraph("3. Strategic Asset Allocation", styles['Heading2']))
    
    allocation_data = [
        ['Asset Class', 'Target Allocation', 'Allowable Range'],
        ['Domestic Equities', '40%', '35% - 45%'],
        ['International Equities', '20%', '15% - 25%'],
        ['Fixed Income', '25%', '20% - 30%'],
        ['Real Estate', '10%', '5% - 15%'],
        ['Alternative Investments', '5%', '0% - 10%']
    ]
    
    allocation_table = Table(allocation_data, colWidths=[2.5*inch, 2*inch, 2*inch])
    allocation_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4472C4')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 11),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    
    story.append(allocation_table)
    story.append(Spacer(1, 0.2*inch))
    
    # Risk Management
    story.append(Paragraph("4. Risk Management Guidelines", styles['Heading2']))
    risk_text = """
    The following risk management guidelines shall be observed:
    
    • No single security shall exceed 5% of the total portfolio value
    • Maximum sector concentration shall not exceed 20% of equity holdings
    • Fixed income securities must maintain a minimum credit rating of BBB or higher
    • Currency exposure shall be hedged when exceeding 15% of total portfolio
    • Portfolio volatility should not exceed 12% annualized standard deviation
    • Maximum drawdown limit is set at 15% from previous peak
    """
    story.append(Paragraph(risk_text, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Rebalancing
    story.append(Paragraph("5. Rebalancing Procedures", styles['Heading2']))
    rebalancing_text = """
    The portfolio shall be rebalanced under the following circumstances:
    
    • Quarterly review: When any asset class deviates by more than 5% from target allocation
    • Annual review: Comprehensive rebalancing to target allocations regardless of drift
    • Significant market events: Ad-hoc rebalancing may be triggered by major market movements
    • Tax considerations: Rebalancing decisions should account for tax implications
    
    All rebalancing activities shall be documented and reviewed by the Investment Committee.
    """
    story.append(Paragraph(rebalancing_text, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Performance Monitoring
    story.append(Paragraph("6. Performance Monitoring and Reporting", styles['Heading2']))
    monitoring_text = """
    Investment performance shall be monitored and reported as follows:
    
    • Monthly performance reports comparing actual returns to benchmarks
    • Quarterly comprehensive portfolio review including asset allocation analysis
    • Annual policy review and update to reflect changing market conditions
    • Regular risk metrics reporting including volatility, Sharpe ratio, and maximum drawdown
    
    The Investment Committee shall meet quarterly to review portfolio performance and
    ensure compliance with this policy.
    """
    story.append(Paragraph(monitoring_text, styles['BodyText']))
    story.append(Spacer(1, 0.3*inch))
    
    # Approval
    story.append(Paragraph("Policy Approval", styles['Heading3']))
    story.append(Paragraph("This policy has been reviewed and approved by the Board of Directors.", styles['BodyText']))
    
    doc.build(story)
    print(f"Created: {filename}")

def create_risk_assessment(filename):
    """Create a risk assessment report"""
    doc = SimpleDocTemplate(filename, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []
    
    # Title
    story.append(Paragraph("Enterprise Risk Assessment Report", styles['Title']))
    story.append(Paragraph("Annual Review - 2024", styles['Heading2']))
    story.append(Spacer(1, 0.3*inch))
    
    # Executive Summary
    story.append(Paragraph("Executive Summary", styles['Heading2']))
    summary_text = """
    This annual risk assessment evaluates the key risks facing the organization and provides
    recommendations for mitigation strategies. The assessment identifies both financial and
    operational risks that could impact business objectives and stakeholder value.
    """
    story.append(Paragraph(summary_text, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Risk Categories
    story.append(Paragraph("Identified Risk Categories", styles['Heading2']))
    
    risk_data = [
        ['Risk Category', 'Likelihood', 'Impact', 'Risk Score', 'Priority'],
        ['Market Risk', 'High', 'High', '9', 'Critical'],
        ['Credit Risk', 'Medium', 'High', '6', 'High'],
        ['Operational Risk', 'Medium', 'Medium', '4', 'Medium'],
        ['Regulatory Risk', 'Low', 'High', '3', 'Medium'],
        ['Cyber Security Risk', 'High', 'Critical', '12', 'Critical'],
        ['Liquidity Risk', 'Low', 'Medium', '2', 'Low']
    ]
    
    risk_table = Table(risk_data, colWidths=[2*inch, 1.3*inch, 1.3*inch, 1.2*inch, 1.2*inch])
    risk_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#C00000')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    
    story.append(risk_table)
    story.append(Spacer(1, 0.3*inch))
    
    # Detailed Analysis
    story.append(Paragraph("Detailed Risk Analysis", styles['Heading2']))
    
    # Market Risk
    story.append(Paragraph("1. Market Risk", styles['Heading3']))
    market_text = """
    Market risk remains a critical concern due to volatile economic conditions and geopolitical
    uncertainties. Interest rate fluctuations and equity market volatility could significantly
    impact portfolio valuations.
    
    Mitigation Strategies:
    • Maintain diversified portfolio across asset classes and geographies
    • Implement hedging strategies using derivatives where appropriate
    • Regular stress testing and scenario analysis
    • Dynamic asset allocation based on market conditions
    """
    story.append(Paragraph(market_text, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Cyber Security Risk
    story.append(Paragraph("2. Cyber Security Risk", styles['Heading3']))
    cyber_text = """
    Cyber security threats continue to evolve and pose significant risks to data integrity,
    operational continuity, and regulatory compliance. Recent increases in ransomware attacks
    and sophisticated phishing attempts require enhanced security measures.
    
    Mitigation Strategies:
    • Implement multi-factor authentication across all systems
    • Regular security audits and penetration testing
    • Employee training and awareness programs
    • Incident response plan and business continuity procedures
    • Investment in advanced threat detection and prevention technologies
    """
    story.append(Paragraph(cyber_text, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Credit Risk
    story.append(Paragraph("3. Credit Risk", styles['Heading3']))
    credit_text = """
    Credit risk arises from potential defaults by counterparties and borrowers. The current
    economic environment has increased the probability of credit events, particularly in
    certain industry sectors.
    
    Mitigation Strategies:
    • Enhanced due diligence on new counterparties
    • Regular credit rating reviews and monitoring
    • Diversification of counterparty exposure
    • Collateral requirements for high-risk transactions
    • Credit derivatives for risk transfer where appropriate
    """
    story.append(Paragraph(credit_text, styles['BodyText']))
    story.append(Spacer(1, 0.3*inch))
    
    # Recommendations
    story.append(Paragraph("Recommendations", styles['Heading2']))
    recommendations_text = """
    Based on this assessment, the following actions are recommended:
    
    1. Establish a dedicated Risk Management Committee to oversee implementation of mitigation strategies
    2. Increase budget allocation for cyber security infrastructure by 25%
    3. Conduct quarterly risk reviews with scenario planning exercises
    4. Enhance risk reporting framework with real-time dashboards
    5. Develop comprehensive business continuity and disaster recovery plans
    6. Implement automated risk monitoring systems for early warning signals
    """
    story.append(Paragraph(recommendations_text, styles['BodyText']))
    story.append(Spacer(1, 0.3*inch))
    
    story.append(Paragraph(f"Report Date: {datetime.now().strftime('%B %d, %Y')}", styles['Italic']))
    
    doc.build(story)
    print(f"Created: {filename}")

def create_expense_policy(filename):
    """Create a corporate expense policy document"""
    doc = SimpleDocTemplate(filename, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []
    
    # Title
    story.append(Paragraph("Corporate Expense Reimbursement Policy", styles['Title']))
    story.append(Spacer(1, 0.3*inch))
    
    # Purpose
    story.append(Paragraph("1. Purpose and Scope", styles['Heading2']))
    purpose_text = """
    This policy establishes guidelines for business expense reimbursement and corporate card usage.
    All employees, contractors, and consultants incurring business expenses on behalf of the company
    must comply with these policies.
    """
    story.append(Paragraph(purpose_text, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Travel Expenses
    story.append(Paragraph("2. Travel Expense Guidelines", styles['Heading2']))
    
    travel_data = [
        ['Expense Category', 'Policy Limit', 'Documentation Required'],
        ['Domestic Airfare', 'Economy Class', 'Boarding pass & receipt'],
        ['International Airfare', 'Business Class (>6 hrs)', 'Boarding pass & receipt'],
        ['Hotel Accommodation', '$250/night', 'Itemized hotel bill'],
        ['Meal Allowance', '$75/day', 'Receipts for meals >$25'],
        ['Ground Transportation', 'Reasonable costs', 'Receipt required'],
        ['Rental Car', 'Standard/Mid-size', 'Rental agreement & receipt']
    ]
    
    travel_table = Table(travel_data, colWidths=[2.2*inch, 2.2*inch, 2.2*inch])
    travel_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#70AD47')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.lightgrey),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    
    story.append(travel_table)
    story.append(Spacer(1, 0.2*inch))
    
    # General Expenses
    story.append(Paragraph("3. General Business Expenses", styles['Heading2']))
    general_text = """
    The following expenses are eligible for reimbursement when directly related to business activities:
    
    • Client entertainment: Maximum $150 per person with prior approval
    • Office supplies: Reasonable amounts for business use
    • Professional development: Pre-approved training and conferences
    • Communication: Mobile phone and internet expenses (business portion only)
    • Parking and tolls: Business-related transportation costs
    
    Non-reimbursable expenses include:
    • Personal entertainment and leisure activities
    • Alcoholic beverages (unless client entertainment)
    • Traffic violations and parking tickets
    • Personal grooming services
    • Upgrades and luxury items
    """
    story.append(Paragraph(general_text, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Submission Process
    story.append(Paragraph("4. Expense Submission Process", styles['Heading2']))
    submission_text = """
    All expense reports must be submitted within 30 days of the expense date:
    
    1. Complete the expense report form in the finance system
    2. Attach all original receipts and supporting documentation
    3. Obtain manager approval for expenses exceeding $500
    4. Submit to Finance Department for processing
    5. Reimbursement will be processed within 10 business days
    
    Expenses submitted after 90 days will not be reimbursed unless exceptional circumstances
    exist and written approval is obtained from the CFO.
    """
    story.append(Paragraph(submission_text, styles['BodyText']))
    story.append(Spacer(1, 0.2*inch))
    
    # Compliance
    story.append(Paragraph("5. Compliance and Violations", styles['Heading2']))
    compliance_text = """
    Failure to comply with this policy may result in:
    • Denial of reimbursement
    • Disciplinary action up to and including termination
    • Requirement to repay improperly reimbursed amounts
    
    All employees must certify that expenses claimed are legitimate business expenses and comply
    with company policy and applicable tax regulations.
    """
    story.append(Paragraph(compliance_text, styles['BodyText']))
    story.append(Spacer(1, 0.3*inch))
    
    story.append(Paragraph("Policy effective date: January 1, 2024", styles['Italic']))
    story.append(Paragraph("Questions should be directed to the Finance Department", styles['Italic']))
    
    doc.build(story)
    print(f"Created: {filename}")

def main():
    """Main function to generate all demo PDFs"""
    # Create data directory if it doesn't exist
    output_dir = "data"
    os.makedirs(output_dir, exist_ok=True)
    
    print("Generating demo PDF documents...")
    print("-" * 50)
    
    # Generate quarterly reports
    companies = [
        ("TechCorp Industries", 1, 2024),
        ("TechCorp Industries", 2, 2024),
        ("Global Finance Solutions", 3, 2024)
    ]
    
    for company, quarter, year in companies:
        filename = f"{output_dir}/{company.replace(' ', '_')}_Q{quarter}_{year}_Report.pdf"
        create_quarterly_report(filename, company, quarter, year)
    
    # Generate policy documents
    create_investment_policy(f"{output_dir}/Investment_Policy_2024.pdf")
    create_risk_assessment(f"{output_dir}/Risk_Assessment_Report_2024.pdf")
    create_expense_policy(f"{output_dir}/Corporate_Expense_Policy.pdf")
    
    print("-" * 50)
    print(f"Successfully generated {len(companies) + 3} PDF documents in '{output_dir}' directory")
    print("\nGenerated files:")
    for file in sorted(os.listdir(output_dir)):
        if file.endswith('.pdf'):
            filepath = os.path.join(output_dir, file)
            size = os.path.getsize(filepath)
            print(f"  • {file} ({size:,} bytes)")

if __name__ == "__main__":
    main()
